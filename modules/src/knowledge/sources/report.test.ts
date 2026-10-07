import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { getSourceReport } from "./report";

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});
const rights: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "UNKNOWN",
};

describe("getSourceReport", () => {
  let t: TestDb;
  let ctx: ServiceContext;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" } });
  });
  afterEach(async () => {
    await t.close();
  });

  it("sums pages, cards, quotes, flags, model runs and time for one source", async () => {
    const [brand] = await t.db.select().from(schema.brands);
    const brandId = brand?.id ?? "";
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId,
        type: "GUIDE",
        title: "Гайд",
        originalLanguage: "ru",
        rights,
        processingAttempt: 1,
        processingStatus: "READY",
      })
      .returning();
    const id = source?.id ?? "";
    await t.db.insert(schema.sourcePages).values([
      { sourceAssetId: id, pageNumber: 1, text: "т", charCount: 1, processingAttempt: 1 },
      {
        sourceAssetId: id,
        pageNumber: 2,
        text: "",
        charCount: 0,
        hasTextLayer: false,
        processingAttempt: 1,
      },
    ]);
    await t.db.insert(schema.knowledgeExtractionBatches).values([
      {
        sourceAssetId: id,
        processingAttempt: 1,
        batchIndex: 0,
        pageStart: 1,
        pageEnd: 1,
        mode: "TEXT",
        status: "SUCCEEDED",
      },
      {
        sourceAssetId: id,
        processingAttempt: 1,
        batchIndex: 1,
        pageStart: 2,
        pageEnd: 2,
        mode: "PDF_NATIVE",
        status: "FAILED",
        error: { code: "TIMEOUT", message: "x" },
      },
    ]);
    const card = (over: Partial<typeof schema.knowledgeItems.$inferInsert>) => ({
      brandId,
      title: "к",
      category: "TECHNIQUES",
      claim: "c",
      language: "ru",
      origin: "SOURCE_EXTRACTED" as const,
      sourceAssetId: id,
      reviewStatus: "NEEDS_REVIEW" as const,
      confidence: "0.80",
      ...over,
    });
    await t.db.insert(schema.knowledgeItems).values([
      card({ sourceReference: { pageStart: 1, quote: "q", quoteVerified: true } }),
      card({
        sourceReference: { pageStart: 1, quote: "q", quoteVerified: false },
        reviewFlags: ["QUOTE_UNVERIFIED", "LOW_CONFIDENCE"],
        confidence: "0.40",
      }),
      card({
        reviewStatus: "CHEF_APPROVED",
        sourceReference: { pageStart: 1, quote: "q", quoteVerified: true },
        safetySensitive: true,
        reviewFlags: ["SAFETY_SENSITIVE"],
      }),
      card({ reviewStatus: "ARCHIVED" }),
    ]);
    const run = (over: Partial<typeof schema.generationRuns.$inferInsert>) => ({
      stage: "KNOWLEDGE_EXTRACTION" as const,
      promptId: "knowledge-extractor",
      promptVersion: 1,
      promptHash: "h",
      provider: "fake",
      model: "m",
      params: {} as never,
      inputHash: "i",
      status: "SUCCEEDED" as const,
      usage: { inputTokens: 1000, outputTokens: 200 },
      costUsd: "0.1500",
      latencyMs: 4000,
      sourceAssetId: id,
      ...over,
    });
    await t.db
      .insert(schema.generationRuns)
      .values([
        run({}),
        run({ status: "REPAIRED", repairAttempts: 1, costUsd: "0.0500", latencyMs: 2000 }),
        run({ status: "INVALID_OUTPUT", costUsd: "0.1000", latencyMs: 1000 }),
      ]);

    const report = await getSourceReport(ctx, id);
    expect(report.pages).toEqual({ total: 2, withoutTextLayer: 1, transcribed: 0 });
    expect(report.batches).toEqual({ total: 2, succeeded: 1, failed: 1, pdfNative: 1, text: 1 });
    expect(report.cards).toMatchObject({
      total: 3,
      withQuote: 3,
      quoteVerified: 2,
      quoteVerifiedPercent: 66.7,
      averageConfidence: 0.67,
      flags: {
        QUOTE_UNVERIFIED: 1,
        LOW_CONFIDENCE: 1,
        SAFETY_SENSITIVE: 1,
        DUPLICATE_SUSPECTED: 0,
      },
      embedded: 0,
    });
    expect(report.cards.byStatus).toEqual({
      EXTRACTED: 0,
      NEEDS_REVIEW: 2,
      CHEF_APPROVED: 1,
      ARCHIVED: 1,
    });
    expect(report.runs).toMatchObject({
      total: 3,
      byStage: { KNOWLEDGE_EXTRACTION: 3 },
      invalid: 1,
      repaired: 1,
      inputTokens: 3000,
      outputTokens: 600,
      costUsd: 0.3,
      modelSeconds: 7,
    });
    expect(report.issues).toEqual([
      "Batch 1 (pages 2–2) failed: TIMEOUT",
      "1 model call(s) ended invalid or refused",
      "1 page(s) without a text layer",
    ]);
  });

  it("knows nothing about an unknown source", async () => {
    await expect(getSourceReport(ctx, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      NotFoundError,
    );
  });
});
