import { schema } from "@rc/db";
import { and, asc, cosineDistance, eq, isNotNull, isNull } from "@rc/db/orm";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { embedTexts } from "@rc/lib/providers/embeddings";
import { type ServiceContext, withTransaction } from "../../core";
import { chunkPages } from "../ingestion/chunking";

// Chunk embeddings and the search over raw sources (plan 06 §6.3 step 6, M1-21).

const EMBED_BATCH = 128;

export type IndexChunksResult = { chunks: number; embedded: number; reused: number };

/**
 * Cuts the pages of the source's current attempt into chunks and embeds them. A chunk with the
 * same text and model as before keeps its vector, so running it again costs nothing; chunks that
 * no longer exist are deleted. Safe to run again.
 */
export async function indexSourceChunks(
  ctx: ServiceContext,
  sourceAssetId: string,
): Promise<IndexChunksResult> {
  const [source] = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, sourceAssetId));
  if (!source) throw new NotFoundError("Source not found.", { details: { sourceAssetId } });

  const pages = await ctx.db
    .select()
    .from(schema.sourcePages)
    .where(
      and(
        eq(schema.sourcePages.sourceAssetId, sourceAssetId),
        eq(schema.sourcePages.processingAttempt, source.processingAttempt),
      ),
    )
    .orderBy(asc(schema.sourcePages.pageNumber));
  const chunks = chunkPages(pages, source.originalLanguage);

  const model = ctx.embeddings.model;
  const existing = await ctx.db
    .select({
      contentHash: schema.sourceChunks.contentHash,
      embedding: schema.sourceChunks.embedding,
      embeddingModel: schema.sourceChunks.embeddingModel,
    })
    .from(schema.sourceChunks)
    .where(eq(schema.sourceChunks.sourceAssetId, sourceAssetId));
  const known = new Map(
    existing
      .filter((row) => row.embedding && row.embeddingModel === model)
      .map((row) => [row.contentHash, row.embedding as number[]]),
  );

  const vectors = new Map<string, number[]>();
  for (const chunk of chunks) {
    const vector = known.get(chunk.contentHash);
    if (vector) vectors.set(chunk.contentHash, vector);
  }
  const reused = vectors.size;
  const todo = [
    ...new Map(
      chunks.filter((c) => !vectors.has(c.contentHash)).map((c) => [c.contentHash, c.text]),
    ),
  ];
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const batch = todo.slice(i, i + EMBED_BATCH);
    const embedded = await embedTexts(
      ctx.embeddings,
      batch.map(([, text]) => text),
      { purpose: "document" },
    );
    for (const [index, [hash]] of batch.entries()) {
      const result = embedded[index];
      if (result) vectors.set(hash, result.vector);
    }
  }

  await withTransaction(ctx, async (tx) => {
    await tx.db
      .delete(schema.sourceChunks)
      .where(eq(schema.sourceChunks.sourceAssetId, sourceAssetId));
    for (let i = 0; i < chunks.length; i += 200) {
      await tx.db.insert(schema.sourceChunks).values(
        chunks.slice(i, i + 200).map((chunk) => ({
          sourceAssetId,
          chunkIndex: chunk.chunkIndex,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          sectionPath: chunk.sectionPath,
          text: chunk.text,
          tokenEstimate: chunk.tokenEstimate,
          language: source.originalLanguage,
          contentHash: chunk.contentHash,
          embedding: vectors.get(chunk.contentHash) ?? null,
          embeddingModel: vectors.has(chunk.contentHash) ? model : null,
          processingAttempt: source.processingAttempt,
        })),
      );
    }
  });
  return { chunks: chunks.length, embedded: todo.length, reused };
}

export type SourceSearchHit = {
  chunkId: string;
  sourceAssetId: string;
  sourceTitle: string;
  pageStart: number | null;
  pageEnd: number | null;
  sectionPath: string | null;
  text: string;
  /** Cosine similarity, 0..1. */
  similarity: number;
};

/**
 * Semantic search over the raw text of the sources (the "search sources" panel of the card editor).
 * Archived sources are left out; `sourceAssetId` narrows it to one source. Best match first.
 */
export async function searchSourceChunks(
  ctx: ServiceContext,
  options: { query: string; sourceAssetId?: string; limit?: number },
): Promise<SourceSearchHit[]> {
  const query = options.query.trim();
  if (!query) throw new ValidationError("Enter something to search for.");
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 30);
  const [embedded] = await embedTexts(ctx.embeddings, [query], { purpose: "query" });
  if (!embedded) return [];

  const distance = cosineDistance(schema.sourceChunks.embedding, embedded.vector);
  const rows = await ctx.db
    .select({
      chunkId: schema.sourceChunks.id,
      sourceAssetId: schema.sourceChunks.sourceAssetId,
      sourceTitle: schema.sourceAssets.title,
      pageStart: schema.sourceChunks.pageStart,
      pageEnd: schema.sourceChunks.pageEnd,
      sectionPath: schema.sourceChunks.sectionPath,
      text: schema.sourceChunks.text,
      distance,
    })
    .from(schema.sourceChunks)
    .innerJoin(schema.sourceAssets, eq(schema.sourceAssets.id, schema.sourceChunks.sourceAssetId))
    .where(
      and(
        isNotNull(schema.sourceChunks.embedding),
        isNull(schema.sourceAssets.archivedAt),
        options.sourceAssetId
          ? eq(schema.sourceChunks.sourceAssetId, options.sourceAssetId)
          : undefined,
      ),
    )
    .orderBy(distance, asc(schema.sourceChunks.id))
    .limit(limit);
  return rows.map(({ distance: d, ...row }) => ({
    ...row,
    similarity: Math.round((1 - Number(d)) * 10_000) / 10_000,
  }));
}
