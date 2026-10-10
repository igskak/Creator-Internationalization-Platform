import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import { and, eq, inArray, ne, sql } from "@rc/db/orm";
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { transitionVariant, verifyApprovedVersion } from "../content";
import { audit, type ServiceContext, withTransaction } from "../core";
import { formatLocalDateTime, offsetLabel } from "./time";

type Publication = typeof schema.publications.$inferSelect;

// Scheduling (plan 05 §5.8, 10 §10.4.3 rows 11 and 13, M4-08): an approved variant gets a
// publication at a time; the time can change, and a publication that has not left can be called
// off. The dispatcher and "publish now" arrive with M5; until then only `SCHEDULED` is accepted.

/** The earliest a post can be scheduled for, from now (10 §10.4.3 row 11). */
export const MIN_LEAD_MINUTES = 5;
const MINUTE_MS = 60_000;
const DEFAULT_MIN_GAP_MINUTES = 180;

export const SchedulePublicationInput = z.object({
  variantId: z.uuid(),
  mode: z.enum(["IMMEDIATE", "SCHEDULED"]).default("SCHEDULED"),
  /** ISO 8601 in UTC (the UI converts from the market's time zone). */
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  dryRun: z.boolean().default(false),
});
export type SchedulePublicationInput = z.input<typeof SchedulePublicationInput>;

export const ReschedulePublicationInput = z.object({
  publicationId: z.uuid(),
  scheduledAt: z.iso.datetime({ offset: true }),
});
export const CancelPublicationInput = z.object({
  publicationId: z.uuid(),
  reason: z.string().trim().min(1, "Say why the post is called off.").max(500),
});

export type ScheduleWarning =
  | { code: "NO_ACTIVE_ACCOUNT"; message: string }
  | { code: "PUBLISHING_DISABLED"; message: string }
  | {
      code: "MIN_GAP";
      message: string;
      /** The other post that is too close. */
      otherPublicationId: string;
      otherAt: string;
      minGapMinutes: number;
    };

export type ScheduleResult = { publication: Publication; warnings: ScheduleWarning[] };

const parse = <S extends z.ZodType>(schemaOf: S, raw: unknown): z.output<S> => {
  const parsed = schemaOf.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
};

const actorUserId = (ctx: ServiceContext) => (ctx.actor.type === "USER" ? ctx.actor.userId : null);

/** The time must be at least five minutes ahead. */
function checkLead(ctx: ServiceContext, at: Date): void {
  const earliest = new Date(ctx.clock.now().getTime() + MIN_LEAD_MINUTES * MINUTE_MS);
  if (at.getTime() < earliest.getTime()) {
    const message = `Pick a time at least ${MIN_LEAD_MINUTES} minutes from now.`;
    throw new ValidationError(message, { fieldErrors: { scheduledAt: [message] } });
  }
}

/** Whether a database error is the violation of a named unique index (Drizzle wraps the driver's error). */
function violates(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: { constraint?: string; code?: string } }).cause;
  return (
    cause?.constraint === constraint ||
    String((error as Error).message).includes(constraint) ||
    String((cause as { message?: string } | undefined)?.message).includes(constraint)
  );
}

async function readSetting<T>(ctx: ServiceContext, key: string, fallback: T): Promise<T> {
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key));
  return (row?.value as T | undefined) ?? fallback;
}

/**
 * What is worth telling the person about a time, without refusing it (05 §5.8): no ACTIVE
 * Instagram account for the market yet, publishing switched off, or another post of the market
 * within `publishing.min_gap_minutes`.
 */
export async function scheduleWarnings(
  ctx: ServiceContext,
  input: { marketId: string; at: Date; ignorePublicationId?: string },
): Promise<ScheduleWarning[]> {
  const warnings: ScheduleWarning[] = [];
  const [account] = await ctx.db
    .select({ id: schema.socialAccounts.id })
    .from(schema.socialAccounts)
    .where(
      and(
        eq(schema.socialAccounts.marketId, input.marketId),
        eq(schema.socialAccounts.status, "ACTIVE"),
      ),
    );
  if (!account) {
    warnings.push({
      code: "NO_ACTIVE_ACCOUNT",
      message: "This market has no connected Instagram account yet: the post will wait.",
    });
  }
  if ((await readSetting<boolean>(ctx, "publishing.enabled", false)) !== true) {
    warnings.push({
      code: "PUBLISHING_DISABLED",
      message: "Publishing is switched off: the post will wait until it is switched on.",
    });
  }

  const gap = await readSetting<number>(ctx, "publishing.min_gap_minutes", DEFAULT_MIN_GAP_MINUTES);
  if (gap > 0) {
    const others = await ctx.db
      .select({
        id: schema.publications.id,
        at: sql<Date>`coalesce(${schema.publications.publishedAt}, ${schema.publications.scheduledAt})`,
      })
      .from(schema.publications)
      .where(
        and(
          eq(schema.publications.marketId, input.marketId),
          eq(schema.publications.dryRun, false),
          inArray(schema.publications.status, ["SCHEDULED", "QUEUED", "IN_PROGRESS", "PUBLISHED"]),
          ...(input.ignorePublicationId
            ? [ne(schema.publications.id, input.ignorePublicationId)]
            : []),
        ),
      );
    const close = others
      .map((o) => ({ ...o, at: new Date(o.at) }))
      .filter((o) => Math.abs(o.at.getTime() - input.at.getTime()) < gap * MINUTE_MS)
      .sort(
        (a, b) =>
          Math.abs(a.at.getTime() - input.at.getTime()) -
          Math.abs(b.at.getTime() - input.at.getTime()),
      )[0];
    if (close) {
      warnings.push({
        code: "MIN_GAP",
        message: `Another post of this market is within ${gap} minutes of this time.`,
        otherPublicationId: close.id,
        otherAt: close.at.toISOString(),
        minGapMinutes: gap,
      });
    }
  }
  return warnings;
}

/**
 * Schedules an APPROVED variant: one SCHEDULED publication of its approved version, the variant
 * becomes SCHEDULED. The time is checked (at least five minutes ahead); the variant must have its
 * approved version intact (`verifyApprovedVersion`); a second live publication of the same variant
 * is refused (by the status and, under a race, by the database's partial unique index). Warnings
 * come back with the result and do not stop it.
 */
export async function schedulePublication(
  ctx: ServiceContext,
  raw: SchedulePublicationInput,
): Promise<ScheduleResult> {
  const input = parse(SchedulePublicationInput, raw);
  if (input.mode === "IMMEDIATE" || input.dryRun) {
    throw new InvalidStateError(
      "Publishing now and dry runs arrive with the Instagram integration. Schedule a time for now.",
    );
  }
  if (!input.scheduledAt) {
    throw new ValidationError("Pick a time.", { fieldErrors: { scheduledAt: ["Pick a time."] } });
  }
  const at = new Date(input.scheduledAt);
  checkLead(ctx, at);

  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, input.variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { id: input.variantId } });
  if (variant.status !== "APPROVED" || !variant.approvedVersionId) {
    throw new InvalidStateError(
      variant.status === "SCHEDULED"
        ? "This draft is already scheduled. Change its time instead."
        : `Only an approved draft can be scheduled, this one is ${variant.status}.`,
      { details: { variantId: variant.id, status: variant.status } },
    );
  }
  const check = await verifyApprovedVersion(ctx, variant.approvedVersionId);
  if (!check.ok) {
    throw new InvalidStateError("The approved version does not match its images any more.", {
      details: { problems: check.problems },
    });
  }
  const warnings = await scheduleWarnings(ctx, { marketId: variant.marketId, at });

  const publicationId = randomUUID();
  const publication = await withTransaction(ctx, async (tx) => {
    let row: Publication | undefined;
    try {
      [row] = await tx.db
        .insert(schema.publications)
        .values({
          id: publicationId,
          contentVariantId: variant.id,
          contentVariantVersionId: variant.approvedVersionId as string,
          marketId: variant.marketId,
          mode: "SCHEDULED",
          scheduledAt: at,
          status: "SCHEDULED",
          idempotencyKey: `pub:${publicationId}:0`,
          createdBy: actorUserId(ctx),
        })
        .returning();
    } catch (error) {
      if (violates(error, "publications_one_live_per_variant_uq")) {
        throw new ConflictError("This draft already has a post. Reload.");
      }
      throw error;
    }
    if (!row) throw new Error("Insert returned no row.");
    await transitionVariant(tx, {
      variantId: variant.id,
      event: "SCHEDULE",
      data: { publicationId, scheduledAt: at.toISOString() },
    });
    await audit(tx, {
      action: "publication.scheduled",
      entityType: "publication",
      entityId: publicationId,
      marketId: variant.marketId,
      data: {
        variantId: variant.id,
        versionId: variant.approvedVersionId,
        scheduledAt: at.toISOString(),
        warnings: warnings.map((w) => w.code),
      },
    });
    return row;
  });
  return { publication, warnings };
}

/** Moves a SCHEDULED publication to another time (same rules as scheduling; warnings again). */
export async function reschedulePublication(
  ctx: ServiceContext,
  raw: z.input<typeof ReschedulePublicationInput>,
): Promise<ScheduleResult> {
  const input = parse(ReschedulePublicationInput, raw);
  const at = new Date(input.scheduledAt);
  checkLead(ctx, at);

  const publication = await withTransaction(ctx, async (tx) => {
    const [current] = await tx.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.id, input.publicationId))
      .for("update");
    if (!current) {
      throw new NotFoundError("Publication not found.", { details: { id: input.publicationId } });
    }
    if (current.status !== "SCHEDULED") {
      throw new InvalidStateError(
        `Only a scheduled post can be moved, this one is ${current.status}.`,
        { details: { status: current.status } },
      );
    }
    const [row] = await tx.db
      .update(schema.publications)
      .set({ scheduledAt: at })
      .where(eq(schema.publications.id, current.id))
      .returning();
    if (!row) throw new Error("Update returned no row.");
    await audit(tx, {
      action: "publication.rescheduled",
      entityType: "publication",
      entityId: current.id,
      marketId: current.marketId,
      data: {
        variantId: current.contentVariantId,
        from: current.scheduledAt?.toISOString() ?? null,
        to: at.toISOString(),
      },
    });
    return row;
  });
  const warnings = await scheduleWarnings(ctx, {
    marketId: publication.marketId,
    at,
    ignorePublicationId: publication.id,
  });
  return { publication, warnings };
}

/**
 * Calls off a SCHEDULED or QUEUED publication: it becomes CANCELLED (who and when are kept) and
 * the variant goes back to APPROVED, ready to be scheduled again.
 */
export async function cancelPublication(
  ctx: ServiceContext,
  raw: z.input<typeof CancelPublicationInput>,
): Promise<Publication> {
  const input = parse(CancelPublicationInput, raw);
  return withTransaction(ctx, async (tx) => {
    const [current] = await tx.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.id, input.publicationId))
      .for("update");
    if (!current) {
      throw new NotFoundError("Publication not found.", { details: { id: input.publicationId } });
    }
    if (!["SCHEDULED", "QUEUED"].includes(current.status)) {
      throw new InvalidStateError(
        `Only a post that has not gone out can be cancelled, this one is ${current.status}.`,
        { details: { status: current.status } },
      );
    }
    const [row] = await tx.db
      .update(schema.publications)
      .set({
        status: "CANCELLED",
        cancelledAt: ctx.clock.now(),
        cancelledBy: actorUserId(ctx),
      })
      .where(eq(schema.publications.id, current.id))
      .returning();
    if (!row) throw new Error("Update returned no row.");
    await audit(tx, {
      action: "publication.cancelled",
      entityType: "publication",
      entityId: current.id,
      marketId: current.marketId,
      data: { variantId: current.contentVariantId, reason: input.reason, cause: "CANCEL" },
    });
    await transitionVariant(tx, {
      variantId: current.contentVariantId,
      event: "CANCEL_SCHEDULE",
      reason: input.reason,
      data: { publicationId: current.id },
    });
    return row;
  });
}

/** "Tue 20 Oct 13:00 (UTC+2)" in the market's zone: the wording of confirmations and warnings. */
export function describeSlot(at: Date, timeZone: string): string {
  return `${formatLocalDateTime(at, timeZone).replace("T", " ")} (${offsetLabel(at, timeZone)})`;
}
