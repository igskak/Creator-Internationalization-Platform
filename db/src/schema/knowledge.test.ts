import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RightsPolicy } from "../json";
import { createTestDb, type TestDb } from "../test-db";
import { brands } from "./core";
import {
  generationRuns,
  historicalPosts,
  knowledgeExtractionBatches,
  knowledgeItems,
  knowledgeItemVersions,
  sourceAssets,
  sourceChunks,
  sourcePages,
} from "./knowledge";

// Synthetic data only.
const rights: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "DENIED",
};

/** Unit vector along one axis, so cosine distances are easy to predict. */
const axis = (i: number) => Array.from({ length: 1536 }, (_, k) => (k === i ? 1 : 0));

describe("0002_knowledge", () => {
  let t: TestDb;
  let brandId: string;
  let sourceId: string;

  beforeAll(async () => {
    t = await createTestDb();
    const [brand] = await t.db.insert(brands).values({ slug: "k-brand", name: "K" }).returning();
    brandId = brand?.id ?? "";
    const [source] = await t.db
      .insert(sourceAssets)
      .values({
        brandId,
        type: "GUIDE",
        title: "Synthetic guide",
        originalLanguage: "ru",
        rights,
        checksumSha256: "abc",
      })
      .returning();
    sourceId = source?.id ?? "";
  });

  afterAll(async () => {
    await t.close();
  });

  it("enables RLS on every knowledge table", async () => {
    const names = [
      "source_assets",
      "source_pages",
      "source_chunks",
      "generation_runs",
      "knowledge_extraction_batches",
      "knowledge_items",
      "knowledge_item_versions",
      "historical_posts",
    ];
    const result = await t.db.execute<{ relname: string; relrowsecurity: boolean }>(sql`
      select relname, relrowsecurity from pg_class
      where relname in (${sql.join(
        names.map((n) => sql`${n}`),
        sql`, `,
      )})`);
    expect(result.rows).toHaveLength(names.length);
    expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("applies source defaults and round-trips the rights policy", async () => {
    const [row] = await t.db.select().from(sourceAssets).where(eq(sourceAssets.id, sourceId));
    expect(row).toMatchObject({
      rights,
      rightsStatus: "UNKNOWN",
      processingStatus: "PENDING_UPLOAD",
      processingAttempt: 0,
      processingProgress: {},
      metadataJson: {},
    });
  });

  it("rejects a second live source with the same checksum, allows it once archived", async () => {
    const dup = {
      brandId,
      type: "GUIDE" as const,
      title: "Dup",
      originalLanguage: "ru",
      rights,
      checksumSha256: "abc",
    };
    await expect(t.db.insert(sourceAssets).values(dup)).rejects.toThrow();
    await t.db.insert(sourceAssets).values({ ...dup, checksumSha256: null });
    await t.db.insert(sourceAssets).values({ ...dup, checksumSha256: null });
    await t.db
      .update(sourceAssets)
      .set({ archivedAt: new Date() })
      .where(eq(sourceAssets.id, sourceId));
    await t.db.insert(sourceAssets).values(dup);
  });

  it("keeps updated_at current", async () => {
    const [created] = await t.db
      .insert(sourceAssets)
      .values({ brandId, type: "NOTE", title: "n", originalLanguage: "ru", rights })
      .returning();
    await new Promise((r) => setTimeout(r, 15));
    const [updated] = await t.db
      .update(sourceAssets)
      .set({ title: "n2" })
      .where(eq(sourceAssets.id, created?.id ?? ""))
      .returning();
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(created?.updatedAt.getTime() ?? 0);
  });

  it("enforces one page number per source and cascades deletes", async () => {
    const [own] = await t.db
      .insert(sourceAssets)
      .values({ brandId, type: "BOOK", title: "b", originalLanguage: "ru", rights })
      .returning();
    const sourceAssetId = own?.id ?? "";
    await t.db
      .insert(sourcePages)
      .values({ sourceAssetId, pageNumber: 1, text: "abc", charCount: 3, processingAttempt: 1 });
    await expect(
      t.db
        .insert(sourcePages)
        .values({ sourceAssetId, pageNumber: 1, text: "x", charCount: 1, processingAttempt: 1 }),
    ).rejects.toThrow();
    await t.db.delete(sourceAssets).where(eq(sourceAssets.id, sourceAssetId));
    const pages = await t.db
      .select()
      .from(sourcePages)
      .where(eq(sourcePages.sourceAssetId, sourceAssetId));
    expect(pages).toHaveLength(0);
  });

  it("chains generation runs and links batches and cards", async () => {
    const run = {
      stage: "KNOWLEDGE_EXTRACTION" as const,
      promptId: "knowledge-extractor",
      promptVersion: 1,
      promptHash: "h",
      provider: "anthropic",
      model: "m",
      params: { maxTokens: 100 },
      inputHash: "i",
      status: "SUCCEEDED" as const,
      sourceAssetId: sourceId,
    };
    const [parent] = await t.db.insert(generationRuns).values(run).returning();
    const [child] = await t.db
      .insert(generationRuns)
      .values({ ...run, status: "REPAIRED", parentRunId: parent?.id, costUsd: "0.1234" })
      .returning();
    expect(child).toMatchObject({ parentRunId: parent?.id, costUsd: "0.1234", repairAttempts: 0 });

    const [batch] = await t.db
      .insert(knowledgeExtractionBatches)
      .values({
        sourceAssetId: sourceId,
        processingAttempt: 1,
        batchIndex: 0,
        pageStart: 1,
        pageEnd: 10,
        mode: "TEXT",
        generationRunId: parent?.id,
      })
      .returning();
    expect(batch?.status).toBe("PENDING");
    await expect(
      t.db.insert(knowledgeExtractionBatches).values({
        sourceAssetId: sourceId,
        processingAttempt: 1,
        batchIndex: 0,
        pageStart: 1,
        pageEnd: 10,
        mode: "TEXT",
      }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(knowledgeExtractionBatches).values({
        sourceAssetId: sourceId,
        processingAttempt: 1,
        batchIndex: 1,
        pageStart: 1,
        pageEnd: 10,
        mode: "OCR" as "TEXT",
      }),
    ).rejects.toThrow();

    const card = {
      brandId,
      title: "Salt early",
      category: "TECHNIQUE",
      claim: "Salt the water before boiling",
      language: "ru",
      origin: "SOURCE_EXTRACTED" as const,
      sourceAssetId: sourceId,
      extractionBatchId: batch?.id,
      ordinalInBatch: 0,
    };
    const [item] = await t.db.insert(knowledgeItems).values(card).returning();
    expect(item).toMatchObject({
      reviewStatus: "EXTRACTED",
      reviewFlags: [],
      tags: [],
      procedureJson: [],
      version: 1,
      safetySensitive: false,
    });
    await expect(t.db.insert(knowledgeItems).values(card)).rejects.toThrow();
    // Manual cards have no batch, so the (batch, ordinal) uniqueness does not apply.
    await t.db
      .insert(knowledgeItems)
      .values({ ...card, extractionBatchId: null, ordinalInBatch: null, origin: "MANUAL" });
    await t.db
      .insert(knowledgeItems)
      .values({ ...card, extractionBatchId: null, ordinalInBatch: null, origin: "MANUAL" });
  });

  it("stores JSON columns, flags and versions", async () => {
    const [item] = await t.db
      .insert(knowledgeItems)
      .values({
        brandId,
        title: "Rest the steak",
        category: "TECHNIQUE",
        claim: "Rest before cutting",
        language: "ru",
        origin: "MANUAL",
        reviewFlags: ["QUOTE_UNVERIFIED", "SAFETY_SENSITIVE"],
        temperaturesJson: [{ value: 54, unit: "C", target: "CORE", context: "medium rare" }],
        timingsJson: [{ value: 5, valueMax: 8, unit: "min", context: "rest" }],
        sourceReference: { quote: "q", quoteVerified: false },
        confidence: "0.85",
      })
      .returning();
    expect(item?.temperaturesJson[0]?.target).toBe("CORE");
    expect(item?.confidence).toBe("0.85");

    const flagged = await t.db
      .select({ id: knowledgeItems.id })
      .from(knowledgeItems)
      .where(sql`${knowledgeItems.reviewFlags} @> ARRAY['SAFETY_SENSITIVE']::text[]`);
    expect(flagged.map((r) => r.id)).toContain(item?.id);

    const snapshot = {
      title: "Rest the steak",
      category: "TECHNIQUE",
      subcategory: null,
      claim: "Rest before cutting",
      explanation: "",
      procedure: [],
      ingredients: [],
      temperatures: [],
      timings: [],
      commonMistakes: [],
      sourceReference: null,
      language: "ru",
      safetySensitive: false,
      safetyNotes: null,
      tags: [],
    };
    const version = {
      knowledgeItemId: item?.id ?? "",
      version: 1,
      snapshot,
      status: "CHEF_APPROVED" as const,
    };
    await t.db.insert(knowledgeItemVersions).values(version);
    await expect(t.db.insert(knowledgeItemVersions).values(version)).rejects.toThrow();
  });

  it("runs a cosine nearest-neighbour query over card embeddings", async () => {
    const base = {
      brandId,
      category: "TECHNIQUE",
      language: "ru",
      origin: "MANUAL" as const,
      reviewStatus: "CHEF_APPROVED" as const,
    };
    await t.db.insert(knowledgeItems).values([
      { ...base, title: "axis-0", claim: "a", embedding: axis(0), embeddingModel: "test" },
      { ...base, title: "axis-1", claim: "b", embedding: axis(1), embeddingModel: "test" },
    ]);
    const query = `[${axis(0).join(",")}]`;
    const rows = await t.db.execute<{ title: string; distance: number }>(sql`
      select title, embedding <=> ${query}::vector as distance
      from knowledge_items
      where embedding is not null
      order by embedding <=> ${query}::vector
      limit 2`);
    expect(rows.rows.map((r) => r.title)).toEqual(["axis-0", "axis-1"]);
    expect(Number(rows.rows[0]?.distance)).toBeCloseTo(0, 5);
    expect(Number(rows.rows[1]?.distance)).toBeCloseTo(1, 5);
  });

  it("stores chunk embeddings", async () => {
    await t.db.insert(sourceChunks).values({
      sourceAssetId: sourceId,
      chunkIndex: 0,
      text: "chunk",
      tokenEstimate: 2,
      language: "ru",
      contentHash: "h",
      processingAttempt: 1,
      embedding: axis(3),
    });
    const rows = await t.db
      .select()
      .from(sourceChunks)
      .where(eq(sourceChunks.sourceAssetId, sourceId));
    expect(rows[0]?.embedding).toHaveLength(1536);
  });

  it("stores historical posts with unique (platform, external_id) and a valid annotation status", async () => {
    const post = {
      brandId,
      accountHandle: "test_account",
      externalId: "p1",
      format: "CAROUSEL" as const,
      caption: "caption",
      metrics: { likes: 10, collectedAt: "2026-10-01T10:00:00+00:00" },
    };
    const [row] = await t.db.insert(historicalPosts).values(post).returning();
    expect(row).toMatchObject({
      platform: "instagram",
      annotationStatus: "NONE",
      isExemplar: false,
      annotations: {},
    });
    await expect(t.db.insert(historicalPosts).values(post)).rejects.toThrow();
    await expect(
      t.db
        .insert(historicalPosts)
        .values({ ...post, externalId: "p2", annotationStatus: "MAYBE" as "NONE" }),
    ).rejects.toThrow();
  });
});
