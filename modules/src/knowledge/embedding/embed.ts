import { schema } from "@rc/db";
import { and, eq, inArray, isNull, ne, or } from "@rc/db/orm";
import { embeddingHash, embedTexts } from "@rc/lib/providers/embeddings";
import { type ServiceContext, withTransaction } from "../../core";
import { cardEmbeddingText } from "./card-text";

// Card embeddings (plan 06 J3, 04 §4.3 `embedding`, `embedding_model`, `embedding_hash`).

const EMBED_BATCH = 256;

export type EmbedResult = {
  /** Cards that got a new vector. */
  embedded: string[];
  /** Cards whose vector already matched their text and the model. */
  skipped: string[];
};

/**
 * Embeds the given cards (archived ones are left alone). A card is skipped when its stored hash
 * equals the hash of its current text and its `embedding_model` is the provider's model, so
 * unchanged cards cost nothing and a model change re-embeds everything. Safe to run again.
 */
export async function embedKnowledgeItems(
  ctx: ServiceContext,
  knowledgeItemIds: readonly string[],
): Promise<EmbedResult> {
  if (knowledgeItemIds.length === 0) return { embedded: [], skipped: [] };
  const rows = await ctx.db
    .select()
    .from(schema.knowledgeItems)
    .where(
      and(
        inArray(schema.knowledgeItems.id, [...knowledgeItemIds]),
        ne(schema.knowledgeItems.reviewStatus, "ARCHIVED"),
      ),
    );
  const model = ctx.embeddings.model;
  const todo: { id: string; text: string }[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const text = cardEmbeddingText(row);
    const current =
      row.embedding !== null &&
      row.embeddingModel === model &&
      row.embeddingHash === embeddingHash(text);
    if (current) skipped.push(row.id);
    else todo.push({ id: row.id, text });
  }

  const embedded: string[] = [];
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const chunk = todo.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(
      ctx.embeddings,
      chunk.map((c) => c.text),
      { purpose: "document" },
    );
    await withTransaction(ctx, async (tx) => {
      for (const [index, item] of chunk.entries()) {
        const result = vectors[index];
        if (!result) continue;
        await tx.db
          .update(schema.knowledgeItems)
          .set({
            embedding: result.vector,
            embeddingModel: result.model,
            embeddingHash: result.hash,
          })
          .where(eq(schema.knowledgeItems.id, item.id));
        embedded.push(item.id);
      }
    });
  }
  return { embedded, skipped };
}

/** Cards that have no vector yet or one made by another model (for the backfill and re-embed job). */
export async function findStaleKnowledgeItemIds(ctx: ServiceContext): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: schema.knowledgeItems.id })
    .from(schema.knowledgeItems)
    .where(
      and(
        ne(schema.knowledgeItems.reviewStatus, "ARCHIVED"),
        or(
          isNull(schema.knowledgeItems.embedding),
          isNull(schema.knowledgeItems.embeddingModel),
          ne(schema.knowledgeItems.embeddingModel, ctx.embeddings.model),
        ),
      ),
    );
  return rows.map((r) => r.id);
}
