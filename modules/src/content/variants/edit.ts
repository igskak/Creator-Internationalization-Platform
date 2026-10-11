import { schema } from "@rc/db";
import type { CtaSpec, ValidationIssue } from "@rc/db/json";
import { and, desc, eq, inArray, sql } from "@rc/db/orm";
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../../core";
import { getIdeaCards } from "../../knowledge/retrieval";
import { RENDER_DEBOUNCE_SECONDS, requestRender } from "../../visuals";
import { numericReference } from "../pipeline/inputs";
import {
  type ValidationContext,
  validateCitations,
  validateForbiddenPatterns,
  validateNumericFidelity,
  validateSlots,
  validateTextRules,
} from "../validation";
import { columnsOf, contentOf, toDraft } from "./content";
import {
  affectsRender,
  formatFieldPath,
  isWithin,
  type ParsedFieldPath,
  parseFieldPath,
  readField,
  valueSchema,
  writeField,
} from "./field-path";
import { assertReasonCode } from "./reason";
import { assertTransition } from "./state";
import { transitionVariant } from "./transition";

type Variant = typeof schema.contentVariants.$inferSelect;

// The `editVariantField` action (plan 05 §5.7, 10 §10.3, M4-03): one field of a variant is
// replaced, checked, recorded as a review event with its old and new value, and the carousel is
// rendered again. Editing an approved variant sends it back to review (cancelling its post).

export const EditVariantFieldInput = z.object({
  variantId: z.uuid(),
  /** The lock version the reviewer saw; a stale one is a CONFLICT. */
  lockVersion: z.number().int().nonnegative(),
  field: z.string().min(1).max(200),
  value: z.unknown(),
  reasonCode: z.string().trim().min(1).max(60).optional(),
  reason: z.string().trim().max(500).optional(),
  /** Required when the edit undoes an approval or cancels a scheduled post. */
  confirmed: z.boolean().optional(),
});
export type EditVariantFieldInput = z.input<typeof EditVariantFieldInput>;

export type EditVariantFieldResult = {
  variant: Variant;
  /** Null when the value did not change (nothing was recorded). */
  reviewEventId: string | null;
  /** Non-blocking findings about the new value (MAJOR and MINOR). */
  warnings: ValidationIssue[];
  /** Publications that were cancelled because the approval was undone. */
  cancelledPublicationIds: string[];
  /** A render was queued (the new text is not on the images yet). */
  renderQueued: boolean;
};

const numberLocale = (language: string) =>
  language === "es" ? "es-ES" : language === "ru" ? "ru" : "en";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const actorUserId = (ctx: ServiceContext) => (ctx.actor.type === "USER" ? ctx.actor.userId : null);

/** The error for a stale lock version; names who changed the draft last when a review event says. */
export async function staleLockError(
  ctx: ServiceContext,
  variant: Variant,
): Promise<ConflictError> {
  const [last] = await ctx.db
    .select({
      at: schema.reviewEvents.createdAt,
      name: schema.appUsers.displayName,
      email: schema.appUsers.email,
    })
    .from(schema.reviewEvents)
    .leftJoin(schema.appUsers, eq(schema.appUsers.id, schema.reviewEvents.reviewerId))
    .where(eq(schema.reviewEvents.contentVariantId, variant.id))
    .orderBy(desc(schema.reviewEvents.createdAt))
    .limit(1);
  const by = last?.name ?? last?.email;
  return new ConflictError(
    by
      ? `This draft was changed by ${by}. Reload to see the latest version.`
      : "This draft was changed in the meantime. Reload to see the latest version.",
    {
      details: {
        variantId: variant.id,
        currentLockVersion: variant.lockVersion,
        ...(by ? { changedBy: by } : {}),
        ...(last ? { changedAt: last.at.toISOString() } : {}),
      },
    },
  );
}

/** A CTA type is an active `cta_type`; its offer belongs to the variant's market. */
async function assertCta(ctx: ServiceContext, variant: Variant, cta: CtaSpec): Promise<void> {
  const [type] = await ctx.db
    .select({ code: schema.taxonomyTerms.code })
    .from(schema.taxonomyTerms)
    .where(
      and(
        eq(schema.taxonomyTerms.kind, "cta_type"),
        eq(schema.taxonomyTerms.code, cta.type),
        eq(schema.taxonomyTerms.isActive, true),
      ),
    );
  if (!type) {
    throw new ValidationError(`"${cta.type}" is not a CTA type.`, {
      fieldErrors: { value: [`"${cta.type}" is not a CTA type.`] },
    });
  }
  if (cta.offerId) {
    const [offer] = await ctx.db
      .select({ marketId: schema.offers.marketId })
      .from(schema.offers)
      .where(eq(schema.offers.id, cta.offerId));
    if (!offer || offer.marketId !== variant.marketId) {
      throw new ValidationError("The offer does not belong to this market.", {
        fieldErrors: { value: ["The offer does not belong to this market."] },
      });
    }
  }
}

async function assertAsset(ctx: ServiceContext, assetId: string | undefined): Promise<void> {
  if (!assetId) return;
  const [asset] = await ctx.db
    .select({ status: schema.visualAssets.status })
    .from(schema.visualAssets)
    .where(eq(schema.visualAssets.id, assetId));
  if (asset?.status !== "READY") {
    throw new ValidationError("That picture does not exist or is not ready.", {
      fieldErrors: { value: ["That picture does not exist or is not ready."] },
    });
  }
}

const parseInput = <S extends z.ZodType>(schemaOf: S, raw: unknown): z.output<S> => {
  const parsed = schemaOf.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
};

/** Every finding of the validators over a whole draft (the pipeline's checks, minus the shape ones). */
export async function validateDraftContent(
  ctx: ServiceContext,
  variant: Variant,
  content: NonNullable<ReturnType<typeof contentOf>>,
): Promise<ValidationIssue[]> {
  const [market] = await ctx.db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, variant.marketId));
  const cards = await getIdeaCards(ctx, variant.masterIdeaId);
  const context: ValidationContext = {
    locale: numberLocale(market?.language ?? "en"),
    forbiddenPatterns: market?.forbiddenPatterns ?? [],
    ideaKnowledgeIds: new Set(cards.map((c) => c.id)),
    numericReference: numericReference({ cards }),
  };
  const draft = toDraft(content, variant.hookType);
  return [
    ...validateSlots(draft, context),
    ...validateTextRules(draft, context),
    ...validateForbiddenPatterns(draft, context),
    ...validateCitations(draft, context),
    ...validateNumericFidelity(draft, context),
  ];
}

/** Findings about a new content; the ones inside `field` are the edit's own. */
export async function validateEdit(
  ctx: ServiceContext,
  variant: Variant,
  next: NonNullable<ReturnType<typeof contentOf>>,
  field: ParsedFieldPath,
): Promise<{ own: ValidationIssue[]; numericMismatch: boolean }> {
  const all = await validateDraftContent(ctx, variant, next);
  return {
    own: all.filter((issue) => isWithin(issue.fieldPath, field)),
    numericMismatch: all.some((issue) => issue.code === "NUMERIC_MISMATCH"),
  };
}

/**
 * Replaces one field of a variant (plan 05 §5.7). The value must have the field's shape and pass
 * the checks that belong to it (template limits, caption length, forbidden patterns, citations);
 * a number that is not in the cited cards only raises NUMERIC_MISMATCH, which blocks approval.
 * A stale `lockVersion` is a CONFLICT. An approved, scheduled or failed variant goes back to
 * READY_FOR_REVIEW and its open publication is cancelled, but only with `confirmed: true`.
 */
export async function editVariantField(
  ctx: ServiceContext,
  raw: EditVariantFieldInput,
): Promise<EditVariantFieldResult> {
  const input = parseInput(EditVariantFieldInput, raw);
  const field = parseFieldPath(input.field);

  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, input.variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { id: input.variantId } });
  const row = assertTransition(variant.status, "EDIT");
  const invalidates = row.to !== variant.status;
  if (variant.lockVersion !== input.lockVersion) throw await staleLockError(ctx, variant);
  if (invalidates && !input.confirmed) {
    throw new InvalidStateError(
      `This ${variant.status} variant is approved: editing it undoes the approval and cancels its post.`,
      { details: { requiresConfirmation: true, status: variant.status } },
    );
  }
  const content = contentOf(variant);
  if (!content) throw new InvalidStateError("The variant has no draft to edit yet.");

  const parsedValue = valueSchema(field).safeParse(input.value);
  if (!parsedValue.success) {
    throw ValidationError.fromZod(
      new z.ZodError(parsedValue.error.issues.map((i) => ({ ...i, path: ["value", ...i.path] }))),
    );
  }
  const value = parsedValue.data;
  const original = readField(content, field);
  if (same(original, value)) {
    return {
      variant,
      reviewEventId: null,
      warnings: [],
      cancelledPublicationIds: [],
      renderQueued: false,
    };
  }
  if (input.reasonCode) await assertReasonCode(ctx, input.reasonCode);
  if (field.kind === "cta") await assertCta(ctx, variant, value as CtaSpec);
  if (field.kind === "image") await assertAsset(ctx, (value as { assetId?: string }).assetId);

  return applyFieldChange(ctx, {
    variant,
    content,
    field,
    value,
    original,
    action: "EDIT",
    lockVersion: input.lockVersion,
    invalidates,
    reasonCode: input.reasonCode,
    reason: input.reason,
    reviewerId: actorUserId(ctx),
  });
}

export type FieldChange = {
  variant: Variant;
  content: NonNullable<ReturnType<typeof contentOf>>;
  field: ParsedFieldPath;
  /** Already checked against the field's shape. */
  value: unknown;
  original: unknown;
  action: "EDIT" | "REGENERATE";
  /** The lock version the change was made against. */
  lockVersion: number;
  /** The variant is approved: the change undoes it (the caller has the confirmation). */
  invalidates: boolean;
  reasonCode?: string | undefined;
  reason?: string | undefined;
  reviewerId: string | null;
  generationRunId?: string | undefined;
  /** The new content when it is not just `value` written at `field` (a picture plan). */
  next?: NonNullable<ReturnType<typeof contentOf>> | undefined;
  /** Queue the render afterwards (default true); a new picture queues it itself when it is made. */
  queueRender?: boolean | undefined;
};

/**
 * Writes a checked change of one field (shared by edits and regenerations): validates the new
 * content, updates the variant under a row lock, records the review event, cancels the open
 * publication when an approval is undone, and queues the render.
 */
export async function applyFieldChange(
  ctx: ServiceContext,
  change: FieldChange,
): Promise<EditVariantFieldResult> {
  const { variant, content, field, value, original, invalidates } = change;
  const path = formatFieldPath(field);
  const next = change.next ?? writeField(content, field, value);
  const { own, numericMismatch } = await validateEdit(ctx, variant, next, field);
  // A number the cards do not support is not refused: it raises NUMERIC_MISMATCH, which blocks
  // approval until the text is fixed (the closed-book rule of 07 §7.9.3).
  const blocking = own.filter((i) => i.severity === "BLOCKER" && i.code !== "NUMERIC_MISMATCH");
  if (blocking.length > 0) {
    throw new ValidationError(blocking[0]?.message ?? "The value is not allowed here.", {
      fieldErrors: { value: blocking.map((i) => i.message) },
      details: { issues: blocking },
    });
  }
  const warnings = own.filter((i) => !blocking.includes(i));

  const offerId = field.kind === "cta" ? ((value as CtaSpec).offerId ?? null) : null;
  /**
   * The columns to write: the new content and the flags. Built from the row as it is under the
   * lock, so a render or picture job that finished meanwhile (it changes the images and the flags
   * it owns) is not overwritten by the copy this call read before.
   */
  const columnsFor = (base: Variant) => {
    const fresh = contentOf(base);
    const content2 = change.next ?? (fresh ? writeField(fresh, field, value) : next);
    return {
      ...columnsOf(content2, null),
      flags: [
        ...base.flags.filter((f) => f !== "NUMERIC_MISMATCH"),
        ...(numericMismatch ? ["NUMERIC_MISMATCH"] : []),
      ],
      ...(offerId ? { offerId } : {}),
    };
  };

  const done = await withTransaction(ctx, async (tx) => {
    const [locked] = await tx.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variant.id))
      .for("update");
    if (!locked) throw new NotFoundError("Variant not found.");
    if (locked.lockVersion !== change.lockVersion) throw await staleLockError(tx, locked);
    if (locked.status !== variant.status) {
      throw new InvalidStateError("The variant changed status in the meantime. Reload.");
    }

    const columns = columnsFor(locked);
    const open = invalidates
      ? await tx.db
          .select({ id: schema.publications.id })
          .from(schema.publications)
          .where(
            and(
              eq(schema.publications.contentVariantId, variant.id),
              inArray(schema.publications.status, ["SCHEDULED", "QUEUED"]),
            ),
          )
      : [];

    let updated: Variant;
    if (invalidates) {
      updated = await transitionVariant(tx, {
        variantId: variant.id,
        event: "EDIT",
        set: columns,
        data: { field: path },
      });
    } else {
      const [changed] = await tx.db
        .update(schema.contentVariants)
        .set({ ...columns, lockVersion: sql`${schema.contentVariants.lockVersion} + 1` })
        .where(eq(schema.contentVariants.id, variant.id))
        .returning();
      if (!changed) throw new NotFoundError("Variant not found.");
      updated = changed;
      await audit(tx, {
        action: change.action === "EDIT" ? "variant.edited" : "variant.field_regenerated",
        entityType: "content_variant",
        entityId: variant.id,
        marketId: variant.marketId,
        data: { field: path, ...(change.reasonCode ? { reasonCode: change.reasonCode } : {}) },
      });
    }

    const [event] = await tx.db
      .insert(schema.reviewEvents)
      .values({
        contentVariantId: variant.id,
        action: change.action,
        field: path,
        originalValue: original ?? null,
        editedValue: value,
        reviewerId: change.reviewerId,
        reasonCode: change.reasonCode ?? null,
        reason: change.reason || null,
        generationRunId: change.generationRunId ?? null,
        variantLockVersion: change.lockVersion,
      })
      .returning({ id: schema.reviewEvents.id });
    return { updated, eventId: event?.id ?? null, cancelled: open.map((p) => p.id) };
  });

  let renderQueued = false;
  if (affectsRender(field) && change.queueRender !== false) {
    try {
      await requestRender(ctx, variant.id, {
        ...(field.kind === "image" ? {} : { delaySeconds: RENDER_DEBOUNCE_SECONDS }),
      });
      renderQueued = true;
    } catch (error) {
      // The edit is saved; the screen shows the render as out of date and can start it again.
      ctx.logger.warn(
        { err: error, variantId: variant.id },
        "Could not queue the render after an edit.",
      );
    }
  }
  return {
    variant: done.updated,
    reviewEventId: done.eventId,
    warnings,
    cancelledPublicationIds: done.cancelled,
    renderQueued,
  };
}
