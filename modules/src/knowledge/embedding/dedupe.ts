import { schema } from "@rc/db";
import { and, cosineDistance, eq, inArray, isNotNull, lt, ne, or, sql } from "@rc/db/orm";
import type { ServiceContext } from "../../core";

// Dedupe suggestions (plan 07 §7.2.6): a card whose vector is at least this similar (cosine) to an
// older, non-archived card of the same language is flagged DUPLICATE_SUSPECTED with a pointer to
// that card. Nothing is merged automatically; the chef decides.

export const DUPLICATE_SIMILARITY = 0.92;
const FLAG = "DUPLICATE_SUSPECTED";

export type DuplicateSuggestion = { id: string; duplicateOfId: string; similarity: number };

/**
 * Compares each given card with older cards (by `created_at`, ties by id, so of a pair exactly one
 * is flagged: the newer one). A card that no longer matches loses a flag set earlier. Returns the
 * suggestions made. Cards without a vector or archived are ignored.
 */
export async function suggestDuplicates(
  ctx: ServiceContext,
  knowledgeItemIds: readonly string[],
): Promise<DuplicateSuggestion[]> {
  if (knowledgeItemIds.length === 0) return [];
  const cards = await ctx.db
    .select()
    .from(schema.knowledgeItems)
    .where(
      and(
        inArray(schema.knowledgeItems.id, [...knowledgeItemIds]),
        ne(schema.knowledgeItems.reviewStatus, "ARCHIVED"),
        isNotNull(schema.knowledgeItems.embedding),
      ),
    );

  const suggestions: DuplicateSuggestion[] = [];
  for (const card of cards) {
    if (!card.embedding) continue;
    const distance = cosineDistance(schema.knowledgeItems.embedding, card.embedding);
    const [nearest] = await ctx.db
      .select({ id: schema.knowledgeItems.id, distance })
      .from(schema.knowledgeItems)
      .where(
        and(
          eq(schema.knowledgeItems.language, card.language),
          ne(schema.knowledgeItems.reviewStatus, "ARCHIVED"),
          isNotNull(schema.knowledgeItems.embedding),
          ne(schema.knowledgeItems.id, card.id),
          or(
            lt(schema.knowledgeItems.createdAt, card.createdAt),
            and(
              eq(schema.knowledgeItems.createdAt, card.createdAt),
              lt(schema.knowledgeItems.id, card.id),
            ),
          ),
          sql`${distance} <= ${1 - DUPLICATE_SIMILARITY}`,
        ),
      )
      .orderBy(distance)
      .limit(1);

    const flagged = card.reviewFlags.includes(FLAG);
    if (nearest) {
      const similarity = Math.round((1 - Number(nearest.distance)) * 10_000) / 10_000;
      suggestions.push({ id: card.id, duplicateOfId: nearest.id, similarity });
      await ctx.db
        .update(schema.knowledgeItems)
        .set({
          duplicateOfId: nearest.id,
          reviewFlags: flagged ? card.reviewFlags : [...card.reviewFlags, FLAG],
        })
        .where(eq(schema.knowledgeItems.id, card.id));
    } else if (flagged) {
      // The text changed and the match is gone: take the suggestion back.
      await ctx.db
        .update(schema.knowledgeItems)
        .set({ duplicateOfId: null, reviewFlags: card.reviewFlags.filter((f) => f !== FLAG) })
        .where(eq(schema.knowledgeItems.id, card.id));
    }
  }
  return suggestions;
}
