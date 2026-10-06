import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createServiceContext,
  getStatuses,
  progressPercent,
  type ServiceContext,
} from "../../core";
import { getSourceDetail, listSources } from "./read";

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

describe("progressPercent", () => {
  const of = (processingStatus: string, processingProgress = {}) =>
    progressPercent({ processingStatus, processingProgress });
  it("follows the stages and the batches, and ends at 100", () => {
    expect(of("PENDING_UPLOAD")).toBeNull();
    expect(of("QUEUED")).toBe(1);
    expect(of("PROCESSING", { stage: "SNIFF" })).toBe(2);
    expect(of("PROCESSING", { stage: "PLAN" })).toBe(5);
    expect(of("PROCESSING", { stage: "EXTRACT", batchesTotal: 10, batchesDone: 0 })).toBe(5);
    expect(of("PROCESSING", { stage: "EXTRACT", batchesTotal: 10, batchesDone: 5 })).toBe(50);
    expect(of("PROCESSING", { stage: "EXTRACT", batchesTotal: 10, batchesDone: 10 })).toBe(95);
    expect(of("READY")).toBe(100);
    expect(of("PROCESSING", { stage: "DONE" })).toBe(100);
    expect(of("FAILED")).toBeNull();
  });
});

describe("sources for the library and the source screen", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let brandId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" } });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  const addSource = async (over: Partial<typeof schema.sourceAssets.$inferInsert> = {}) => {
    const [row] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId,
        type: "GUIDE",
        title: "Гайд",
        originalLanguage: "ru",
        rights,
        processingAttempt: 1,
        processingStatus: "READY",
        originalFilename: "guide.pdf",
        fileKey: "k",
        ...over,
      })
      .returning();
    return row?.id ?? "";
  };

  it("lists the library newest first with card counts, and leaves out imports of posts and archived sources", async () => {
    const a = await addSource({ title: "Крупы" });
    await addSource({ title: "Посты", type: "INSTAGRAM_POST" });
    await addSource({ title: "Старый", archivedAt: new Date() });
    await t.db.insert(schema.knowledgeItems).values(
      (["NEEDS_REVIEW", "CHEF_APPROVED", "ARCHIVED"] as const).map((reviewStatus, i) => ({
        brandId,
        title: `К${i}`,
        category: "TECHNIQUES",
        claim: "c",
        language: "ru",
        origin: "SOURCE_EXTRACTED" as const,
        reviewStatus,
        sourceAssetId: a,
      })),
    );
    const list = await listSources(ctx);
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({
      id: a,
      title: "Крупы",
      status: "READY",
      percent: 100,
      cards: 2,
      aiProcessing: "ALLOWED",
      language: "ru",
    });
    expect((await listSources(ctx, { includeArchived: true })).total).toBe(2);
    expect((await listSources(ctx, { q: "кру" })).rows.map((r) => r.title)).toEqual(["Крупы"]);
    expect((await listSources(ctx, { status: "FAILED" })).total).toBe(0);
    expect((await listSources(ctx, { q: "100%" })).total).toBe(0);
  });

  it("shows a source in progress with its percent and a failed one with its error", async () => {
    await addSource({
      title: "В работе",
      processingStatus: "PROCESSING",
      processingProgress: { stage: "EXTRACT", batchesTotal: 4, batchesDone: 2 },
    });
    await addSource({
      title: "Сбой",
      processingStatus: "FAILED",
      processingError: { code: "CORRUPT_PDF", message: "The PDF text could not be extracted." },
    });
    const rows = (await listSources(ctx)).rows;
    expect(rows.find((r) => r.title === "В работе")).toMatchObject({
      status: "PROCESSING",
      percent: 50,
    });
    expect(rows.find((r) => r.title === "Сбой")).toMatchObject({
      percent: null,
      error: { code: "CORRUPT_PDF" },
    });
  });

  it("builds the detail: pages, preview, batches, cards by status, unverified quotes", async () => {
    const id = await addSource();
    await t.db.insert(schema.sourcePages).values(
      [
        {
          sourceAssetId: id,
          pageNumber: 1,
          text: "А".repeat(700),
          charCount: 700,
          processingAttempt: 1,
        },
        {
          sourceAssetId: id,
          pageNumber: 2,
          text: "",
          charCount: 0,
          hasTextLayer: false,
          processingAttempt: 1,
        },
        {
          sourceAssetId: id,
          pageNumber: 3,
          text: "т",
          charCount: 1,
          hasTextLayer: false,
          transcribed: true,
          processingAttempt: 1,
        },
        { sourceAssetId: id, pageNumber: 1, text: "старая", charCount: 6, processingAttempt: 0 },
      ].filter((p) => p.pageNumber !== 1 || p.processingAttempt === 1),
    );
    await t.db.insert(schema.knowledgeExtractionBatches).values([
      {
        sourceAssetId: id,
        processingAttempt: 1,
        batchIndex: 0,
        pageStart: 1,
        pageEnd: 3,
        mode: "TEXT",
        status: "SUCCEEDED",
        cardsCreated: 2,
      },
    ]);
    await t.db.insert(schema.knowledgeItems).values([
      {
        brandId,
        title: "a",
        category: "TECHNIQUES",
        claim: "c",
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "NEEDS_REVIEW",
        sourceAssetId: id,
        reviewFlags: ["QUOTE_UNVERIFIED"],
      },
      {
        brandId,
        title: "b",
        category: "TECHNIQUES",
        claim: "c",
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "CHEF_APPROVED",
        sourceAssetId: id,
      },
      {
        brandId,
        title: "c",
        category: "TECHNIQUES",
        claim: "c",
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "ARCHIVED",
        sourceAssetId: id,
        reviewFlags: ["QUOTE_UNVERIFIED"],
      },
    ]);
    const detail = await getSourceDetail(ctx, id);
    expect(detail.pages).toEqual({ total: 3, withoutText: 2, transcribed: 1 });
    expect(detail.preview.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(detail.preview[0]).toMatchObject({ truncated: true });
    expect(detail.preview[0]?.text).toHaveLength(600);
    expect(detail.batches).toEqual([
      {
        batchIndex: 0,
        pageStart: 1,
        pageEnd: 3,
        mode: "TEXT",
        status: "SUCCEEDED",
        cardsCreated: 2,
        error: null,
      },
    ]);
    expect(detail.cardsByStatus).toEqual({
      EXTRACTED: 0,
      NEEDS_REVIEW: 1,
      CHEF_APPROVED: 1,
      ARCHIVED: 1,
    });
    expect(detail.unverifiedQuotes).toBe(1);
    expect(detail.source).toMatchObject({
      cards: 2,
      attempt: 1,
      rights: { aiProcessing: "ALLOWED" },
    });
    expect(detail).toMatchObject({ hasFile: true, isPdf: true });
    await expect(getSourceDetail(ctx, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("answers getStatuses for sources, and leaves unknown ids out", async () => {
    const running = await addSource({
      processingStatus: "PROCESSING",
      processingProgress: { stage: "EXTRACT", batchesTotal: 2, batchesDone: 1 },
    });
    const failed = await addSource({
      processingStatus: "FAILED",
      processingError: { code: "X", message: "Broken" },
    });
    const statuses = await getStatuses(ctx, {
      sourceIds: [running, failed, "00000000-0000-4000-8000-000000000000"],
    });
    expect(statuses).toEqual({
      [running]: { status: "PROCESSING", progress: 50 },
      [failed]: { status: "FAILED", error: "Broken" },
    });
    expect(await getStatuses(ctx, {})).toEqual({});
  });
});
