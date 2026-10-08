import { schema } from "@rc/db";
import type { KnowledgeSnapshot } from "@rc/db/json";
import { eq, inArray } from "@rc/db/orm";
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { type ServiceContext, transition, withTransaction } from "../../core";
import { requestEmbedding } from "../embedding";
import { clearKnowledgeFlags, flagVariantsCiting } from "./variant-flags";

// Card review transitions (plan 10 §10.4.1, 05 §5.4): approve with a version snapshot, archive with
// a reason, restore. Bulk variants never override an unverified quote.

type Card = typeof schema.knowledgeItems.$inferSelect;

export const ARCHIVE_REASONS = [
  "INACCURATE",
  "DUPLICATE",
  "OUT_OF_SCOPE",
  "SUPERSEDED",
  "OTHER",
] as const;
export const BULK_LIMIT = 100;

export const TransitionCardInput = z.object({
  id: z.uuid(),
  to: z.enum(["CHEF_APPROVED", "NEEDS_REVIEW", "ARCHIVED"]),
  /** Required for ARCHIVED. */
  archiveReason: z.enum(ARCHIVE_REASONS).optional(),
  note: z.string().trim().max(1000).optional(),
  /** Approve a card whose quote could not be verified; needs a note (chef or owner). */
  acceptUnverifiedQuote: z.boolean().optional(),
});

export const BulkTransitionInput = z.object({
  ids: z.array(z.uuid()).min(1).max(BULK_LIMIT),
  to: z.enum(["CHEF_APPROVED", "ARCHIVED"]),
  archiveReason: z.enum(ARCHIVE_REASONS).optional(),
});

export type SkipReason =
  | "QUOTE_UNVERIFIED"
  | "HAS_FLAGS"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "MISSING_FIELDS";

const isChefOrOwner = (ctx: ServiceContext) =>
  ctx.actor.type !== "USER" || ctx.actor.role === "chef" || ctx.actor.role === "owner";

/** All content fields of a card as stored at approval (`knowledge_item_versions.snapshot`). */
export function snapshotOf(card: Card): KnowledgeSnapshot {
  return {
    title: card.title,
    category: card.category,
    subcategory: card.subcategory,
    claim: card.claim,
    explanation: card.explanation,
    procedure: card.procedureJson,
    ingredients: card.ingredientsJson,
    temperatures: card.temperaturesJson,
    timings: card.timingsJson,
    commonMistakes: card.commonMistakesJson,
    sourceReference: card.sourceReference,
    language: card.language,
    safetySensitive: card.safetySensitive,
    safetyNotes: card.safetyNotes,
    tags: card.tags,
  };
}

/** A card with a source quote is verified when the check passed; manual cards have no quote. */
const quoteIsVerified = (card: Card) =>
  card.sourceReference === null || card.sourceReference.quoteVerified === true;

async function loadCard(ctx: ServiceContext, id: string): Promise<Card> {
  const [card] = await ctx.db
    .select()
    .from(schema.knowledgeItems)
    .where(eq(schema.knowledgeItems.id, id));
  if (!card) throw new NotFoundError("Knowledge card not found.", { details: { id } });
  return card;
}

/**
 * Moves one card (10.4.1): NEEDS_REVIEW → CHEF_APPROVED (chef or owner; the quote must be verified,
 * or `acceptUnverifiedQuote` with a note; title, claim and category must be filled; writes a
 * version snapshot and `approved_*`), NEEDS_REVIEW or CHEF_APPROVED → ARCHIVED (reason; an approved
 * card only by chef or owner), ARCHIVED → NEEDS_REVIEW (restore, chef or owner).
 */
export async function transitionKnowledgeCard(
  ctx: ServiceContext,
  raw: z.input<typeof TransitionCardInput>,
): Promise<Card> {
  const parsed = TransitionCardInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const input = parsed.data;
  const card = await loadCard(ctx, input.id);
  const actorId = ctx.actor.type === "USER" ? ctx.actor.userId : null;
  const invalid = () =>
    new InvalidStateError(`Cannot change a card from ${card.reviewStatus} to ${input.to}.`, {
      details: { id: card.id, from: card.reviewStatus, to: input.to },
    });

  if (input.to === "CHEF_APPROVED") {
    if (!isChefOrOwner(ctx))
      throw new ForbiddenError("Only the chef or the owner can approve cards.");
    if (card.reviewStatus !== "NEEDS_REVIEW") throw invalid();
    if (!card.title.trim() || !card.claim.trim() || !card.category.trim()) {
      throw new ValidationError("Fill in the title, claim and category before approving.", {
        fieldErrors: { _form: ["Title, claim and category are required."] },
      });
    }
    const override = input.acceptUnverifiedQuote === true;
    if (!quoteIsVerified(card)) {
      if (!override || !input.note) {
        throw new ValidationError(
          "The quote is not verified. Check the source, or approve with a note.",
          {
            fieldErrors: { note: ["Add a note to approve a card with an unverified quote."] },
          },
        );
      }
    }
    const snapshot = snapshotOf(card);
    const updated = await withTransaction(ctx, async (tx) => {
      const versionRow = {
        knowledgeItemId: card.id,
        version: card.version,
        snapshot,
        status: "CHEF_APPROVED" as const,
        changedBy: actorId,
        changeNote: !quoteIsVerified(card)
          ? `Approved with an unverified quote: ${input.note}`
          : (input.note ?? null),
      };
      // A card archived and restored without an edit is approved again at the same version.
      await tx.db
        .insert(schema.knowledgeItemVersions)
        .values(versionRow)
        .onConflictDoUpdate({
          target: [
            schema.knowledgeItemVersions.knowledgeItemId,
            schema.knowledgeItemVersions.version,
          ],
          set: {
            snapshot: versionRow.snapshot,
            status: versionRow.status,
            changedBy: versionRow.changedBy,
            changeNote: versionRow.changeNote,
          },
        });
      const approved = await transition(tx, {
        table: schema.knowledgeItems,
        statusKey: "reviewStatus",
        id: card.id,
        from: ["NEEDS_REVIEW"],
        to: "CHEF_APPROVED",
        set: { approvedVersion: card.version, approvedBy: actorId, approvedAt: ctx.clock.now() },
        audit: {
          action: "knowledge.approved",
          entityType: "knowledge_item",
          data: {
            version: card.version,
            ...(!quoteIsVerified(card) ? { unverifiedQuoteAccepted: true, note: input.note } : {}),
          },
        },
      });
      // Drafts that were flagged because the card changed or was archived are clear again.
      await clearKnowledgeFlags(tx, [card.id]);
      return approved;
    });
    // The vector is what retrieval searches; the job skips it when it is already current.
    await requestEmbedding(ctx, [card.id]).catch((error: unknown) =>
      ctx.logger.warn(
        { err: error, id: card.id },
        "could not request the embedding of an approved card",
      ),
    );
    return updated;
  }

  if (input.to === "ARCHIVED") {
    if (!input.archiveReason) {
      throw new ValidationError("Choose why the card is archived.", {
        fieldErrors: { archiveReason: ["A reason is required."] },
      });
    }
    if (card.reviewStatus === "CHEF_APPROVED" && !isChefOrOwner(ctx)) {
      throw new ForbiddenError("Only the chef or the owner can archive an approved card.");
    }
    if (card.reviewStatus === "ARCHIVED") throw invalid();
    const { archiveReason } = input;
    return withTransaction(ctx, async (tx) => {
      const archived = await transition(tx, {
        table: schema.knowledgeItems,
        statusKey: "reviewStatus",
        id: card.id,
        from: ["EXTRACTED", "NEEDS_REVIEW", "CHEF_APPROVED"],
        to: "ARCHIVED",
        set: { archiveReason },
        audit: {
          action: "knowledge.archived",
          entityType: "knowledge_item",
          data: {
            reason: archiveReason,
            wasApproved: card.reviewStatus === "CHEF_APPROVED",
            ...(input.note ? { note: input.note } : {}),
          },
        },
      });
      // A draft that cites the card now rests on knowledge that was withdrawn: approval is blocked.
      await flagVariantsCiting(tx, [card.id], "KNOWLEDGE_ARCHIVED");
      return archived;
    });
  }

  // Restore.
  if (!isChefOrOwner(ctx))
    throw new ForbiddenError("Only the chef or the owner can restore cards.");
  if (card.reviewStatus !== "ARCHIVED") throw invalid();
  return transition(ctx, {
    table: schema.knowledgeItems,
    statusKey: "reviewStatus",
    id: card.id,
    from: ["ARCHIVED"],
    to: "NEEDS_REVIEW",
    set: { archiveReason: null },
    audit: { action: "knowledge.restored", entityType: "knowledge_item" },
  });
}

export type BulkResult = {
  done: string[];
  skipped: { id: string; reason: SkipReason }[];
};

/**
 * Approves or archives up to 100 cards. Each card goes through the same guards as a single
 * transition, plus for approval (07 §7.2.8): only cards with a verified quote and no review flags;
 * an unverified quote is skipped, never overridden in bulk. A card that cannot move is reported in
 * `skipped` with the reason; the rest still move.
 */
export async function bulkTransitionKnowledgeCards(
  ctx: ServiceContext,
  raw: z.input<typeof BulkTransitionInput>,
): Promise<BulkResult> {
  const parsed = BulkTransitionInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { ids, to, archiveReason } = parsed.data;
  if (to === "CHEF_APPROVED" && !isChefOrOwner(ctx)) {
    throw new ForbiddenError("Only the chef or the owner can approve cards.");
  }
  if (to === "ARCHIVED" && !archiveReason) {
    throw new ValidationError("Choose why the cards are archived.", {
      fieldErrors: { archiveReason: ["A reason is required."] },
    });
  }

  const unique = [...new Set(ids)];
  const cards = new Map(
    (
      await ctx.db
        .select()
        .from(schema.knowledgeItems)
        .where(inArray(schema.knowledgeItems.id, unique))
    ).map((card) => [card.id, card]),
  );
  const result: BulkResult = { done: [], skipped: [] };
  for (const id of unique) {
    const card = cards.get(id);
    const skip = (reason: SkipReason) => result.skipped.push({ id, reason });
    if (!card) {
      skip("NOT_FOUND");
      continue;
    }
    if (to === "CHEF_APPROVED") {
      if (card.reviewStatus !== "NEEDS_REVIEW") skip("INVALID_STATE");
      else if (!quoteIsVerified(card)) skip("QUOTE_UNVERIFIED");
      else if (card.reviewFlags.length > 0) skip("HAS_FLAGS");
      else if (!card.title.trim() || !card.claim.trim() || !card.category.trim())
        skip("MISSING_FIELDS");
      else {
        await transitionKnowledgeCard(ctx, { id, to });
        result.done.push(id);
      }
      continue;
    }
    if (card.reviewStatus === "ARCHIVED") {
      skip("INVALID_STATE");
      continue;
    }
    if (card.reviewStatus === "CHEF_APPROVED" && !isChefOrOwner(ctx)) {
      throw new ForbiddenError("Only the chef or the owner can archive an approved card.");
    }
    await transitionKnowledgeCard(ctx, { id, to, ...(archiveReason ? { archiveReason } : {}) });
    result.done.push(id);
  }
  return result;
}
