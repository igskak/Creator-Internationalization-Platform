import { schema } from "@rc/db";
import { and, asc, desc, eq, gte, inArray, lt } from "@rc/db/orm";
import { PRESIGN_TTL } from "@rc/lib/providers/storage";
import { z } from "zod";
import type { ServiceContext } from "../core";

// Reads for the calendar (plan 05 §5.8 `getCalendar`, 10 §10.2, M4-09): the posts of a time range
// with what the screen needs to draw them, and the approved drafts that have no time yet.

/** Publication statuses the calendar shows (a cancelled post is not on it; dry runs never are). */
export const CALENDAR_STATUSES = [
  "SCHEDULED",
  "QUEUED",
  "IN_PROGRESS",
  "PUBLISHED",
  "FAILED",
] as const;

const DEFAULT_MIN_GAP_MINUTES = 180;
const DEFAULT_TOPIC_GAP_HOURS = 48;

export const GetCalendarInput = z.object({
  /** ISO 8601, inclusive. */
  from: z.iso.datetime({ offset: true }),
  /** ISO 8601, exclusive. */
  to: z.iso.datetime({ offset: true }),
  marketIds: z.array(z.uuid()).max(20).optional(),
});
export type GetCalendarInput = z.input<typeof GetCalendarInput>;

export type CalendarWarning =
  | "NO_ACTIVE_ACCOUNT"
  | "PUBLISHING_DISABLED"
  | "MIN_GAP"
  | "TOPIC_GAP"
  | "OVERDUE";

export type CalendarItem = {
  publicationId: string;
  variantId: string;
  ideaId: string;
  market: {
    id: string;
    code: string;
    name: string;
    flagEmoji: string | null;
    timeZone: string;
    /** Position among the markets, for a stable color. */
    order: number;
  };
  /** When it goes out (scheduled time), or went out. */
  at: Date;
  status: (typeof CALENDAR_STATUSES)[number];
  /** A Reel gets a badge; its thumbnail is null (there is no still image of it). */
  format: "CAROUSEL" | "REEL";
  title: string;
  /** Presigned URL of the first image of the approved version; null if there is none. */
  thumbnailUrl: string | null;
  warnings: CalendarWarning[];
  permalink: string | null;
};

const MINUTE_MS = 60_000;

async function setting<T>(ctx: ServiceContext, key: string, fallback: T): Promise<T> {
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key));
  return (row?.value as T | undefined) ?? fallback;
}

async function thumbnail(ctx: ServiceContext, key: string | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    return (await ctx.storage.presignGet(key, { expiresInSeconds: PRESIGN_TTL.preview })).url;
  } catch {
    return null;
  }
}

/**
 * The posts of a range, earliest first. Each carries the market (with its time zone), the title
 * (the hook of the approved version), a thumbnail and its warnings: the market has no ACTIVE
 * account, publishing is off, another post of the market is closer than the minimum gap, or the
 * time has passed while it still waits.
 */
export async function getCalendar(
  ctx: ServiceContext,
  raw: GetCalendarInput,
): Promise<CalendarItem[]> {
  const input = GetCalendarInput.parse(raw);
  const from = new Date(input.from);
  const to = new Date(input.to);
  const p = schema.publications;

  const rows = await ctx.db
    .select({
      publicationId: p.id,
      variantId: p.contentVariantId,
      ideaId: schema.contentVariants.masterIdeaId,
      status: p.status,
      scheduledAt: p.scheduledAt,
      publishedAt: p.publishedAt,
      permalink: p.permalink,
      snapshot: schema.contentVariantVersions.snapshot,
      marketId: schema.markets.id,
      marketCode: schema.markets.code,
      marketName: schema.markets.displayName,
      flagEmoji: schema.markets.flagEmoji,
      timeZone: schema.markets.timezone,
      order: schema.markets.sortOrder,
    })
    .from(p)
    .innerJoin(schema.contentVariants, eq(schema.contentVariants.id, p.contentVariantId))
    .innerJoin(
      schema.contentVariantVersions,
      eq(schema.contentVariantVersions.id, p.contentVariantVersionId),
    )
    .innerJoin(schema.markets, eq(schema.markets.id, p.marketId))
    .where(
      and(
        eq(p.dryRun, false),
        inArray(p.status, [...CALENDAR_STATUSES]),
        gte(p.scheduledAt, from),
        lt(p.scheduledAt, to),
        ...(input.marketIds?.length ? [inArray(p.marketId, input.marketIds)] : []),
      ),
    )
    .orderBy(asc(p.scheduledAt), asc(p.id));

  const marketIds = [...new Set(rows.map((r) => r.marketId))];
  const accounts = marketIds.length
    ? await ctx.db
        .select({ marketId: schema.socialAccounts.marketId })
        .from(schema.socialAccounts)
        .where(
          and(
            inArray(schema.socialAccounts.marketId, marketIds),
            eq(schema.socialAccounts.status, "ACTIVE"),
          ),
        )
    : [];
  const withAccount = new Set(accounts.map((a) => a.marketId));
  const enabled = (await setting<boolean>(ctx, "publishing.enabled", false)) === true;
  const gap = await setting<number>(ctx, "publishing.min_gap_minutes", DEFAULT_MIN_GAP_MINUTES);
  const topicGap = await setting<number>(
    ctx,
    "publishing.topic_gap_hours",
    DEFAULT_TOPIC_GAP_HOURS,
  );
  const now = ctx.clock.now().getTime();

  const items = await Promise.all(
    rows.map(async (r): Promise<CalendarItem> => {
      const at = (r.status === "PUBLISHED" ? r.publishedAt : null) ?? (r.scheduledAt as Date);
      return {
        publicationId: r.publicationId,
        variantId: r.variantId,
        ideaId: r.ideaId,
        market: {
          id: r.marketId,
          code: r.marketCode,
          name: r.marketName,
          flagEmoji: r.flagEmoji,
          timeZone: r.timeZone,
          order: r.order,
        },
        at,
        status: r.status as CalendarItem["status"],
        format: r.snapshot.format ?? "CAROUSEL",
        title: r.snapshot.hook,
        thumbnailUrl: await thumbnail(ctx, r.snapshot.renderedSlideKeys[0]),
        warnings: [],
        permalink: r.permalink,
      };
    }),
  );

  for (const item of items) {
    const waiting = item.status === "SCHEDULED" || item.status === "QUEUED";
    if (waiting && !withAccount.has(item.market.id)) item.warnings.push("NO_ACTIVE_ACCOUNT");
    if (waiting && !enabled) item.warnings.push("PUBLISHING_DISABLED");
    if (waiting && item.at.getTime() < now) item.warnings.push("OVERDUE");
    if (gap > 0) {
      const close = items.some(
        (other) =>
          other !== item &&
          other.market.id === item.market.id &&
          Math.abs(other.at.getTime() - item.at.getTime()) < gap * MINUTE_MS,
      );
      if (close) item.warnings.push("MIN_GAP");
    }
    // The Reel and the carousel of one idea (G-10); only posts inside the range are compared.
    if (topicGap > 0) {
      const sameIdea = items.some(
        (other) =>
          other.variantId !== item.variantId &&
          other.ideaId === item.ideaId &&
          other.market.id === item.market.id &&
          Math.abs(other.at.getTime() - item.at.getTime()) < topicGap * 60 * MINUTE_MS,
      );
      if (sameIdea) item.warnings.push("TOPIC_GAP");
    }
  }
  return items;
}

export type ApprovedDraft = {
  variantId: string;
  ideaId: string;
  format: "CAROUSEL" | "REEL";
  title: string;
  ideaTopic: string;
  market: CalendarItem["market"];
  approvedAt: Date;
  thumbnailUrl: string | null;
};

/** Approved drafts that have no post yet, longest waiting first (the calendar's side list). */
export async function listApprovedNotScheduled(ctx: ServiceContext): Promise<ApprovedDraft[]> {
  const v = schema.contentVariants;
  const rows = await ctx.db
    .select({
      variantId: v.id,
      ideaId: v.masterIdeaId,
      ideaTopic: schema.masterIdeas.topic,
      snapshot: schema.contentVariantVersions.snapshot,
      approvedAt: schema.contentVariantVersions.approvedAt,
      marketId: schema.markets.id,
      marketCode: schema.markets.code,
      marketName: schema.markets.displayName,
      flagEmoji: schema.markets.flagEmoji,
      timeZone: schema.markets.timezone,
      order: schema.markets.sortOrder,
    })
    .from(v)
    .innerJoin(
      schema.contentVariantVersions,
      eq(schema.contentVariantVersions.id, v.approvedVersionId),
    )
    .innerJoin(schema.masterIdeas, eq(schema.masterIdeas.id, v.masterIdeaId))
    .innerJoin(schema.markets, eq(schema.markets.id, v.marketId))
    .where(and(eq(v.status, "APPROVED")))
    .orderBy(asc(schema.contentVariantVersions.approvedAt), desc(v.id));
  return Promise.all(
    rows.map(async (r) => ({
      variantId: r.variantId,
      ideaId: r.ideaId,
      format: r.snapshot.format ?? "CAROUSEL",
      title: r.snapshot.hook,
      ideaTopic: r.ideaTopic,
      market: {
        id: r.marketId,
        code: r.marketCode,
        name: r.marketName,
        flagEmoji: r.flagEmoji,
        timeZone: r.timeZone,
        order: r.order,
      },
      approvedAt: r.approvedAt,
      thumbnailUrl: await thumbnail(ctx, r.snapshot.renderedSlideKeys[0]),
    })),
  );
}
