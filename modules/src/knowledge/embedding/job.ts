import { type ServiceContext, triggerJob } from "../../core";
import { type DuplicateSuggestion, suggestDuplicates } from "./dedupe";
import { embedKnowledgeItems, findStaleKnowledgeItemIds } from "./embed";

export type EmbedAndSuggestResult = {
  embedded: number;
  skipped: number;
  duplicates: DuplicateSuggestion[];
};

/**
 * J3 `embed-knowledge-items` (plan 06 §6.3): embeds the given cards, or every stale one when no ids
 * are given (backfill, model change), then suggests duplicates for the cards that got a new
 * vector. Unchanged cards are skipped, so the job is safe to repeat and to retry.
 */
export async function embedAndSuggest(
  ctx: ServiceContext,
  input: { knowledgeItemIds?: readonly string[] | undefined },
): Promise<EmbedAndSuggestResult> {
  const ids = input.knowledgeItemIds ?? (await findStaleKnowledgeItemIds(ctx));
  const { embedded, skipped } = await embedKnowledgeItems(ctx, ids);
  const duplicates = await suggestDuplicates(ctx, embedded);
  ctx.logger.info(
    { embedded: embedded.length, skipped: skipped.length, duplicates: duplicates.length },
    "knowledge items embedded",
  );
  return { embedded: embedded.length, skipped: skipped.length, duplicates };
}

/**
 * Asks for the cards' vectors to be refreshed in the background. Services call it after a card
 * is created, edited or approved. No idempotency key: the job itself skips unchanged cards, and a
 * key would swallow a later edit of the same card.
 */
export async function requestEmbedding(ctx: ServiceContext, knowledgeItemIds: readonly string[]) {
  if (knowledgeItemIds.length === 0) return;
  await triggerJob(ctx, "embed-knowledge-items", { knowledgeItemIds: [...knowledgeItemIds] });
}
