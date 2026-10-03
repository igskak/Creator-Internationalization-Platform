import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { and, asc, eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { PermanentError, RightsBlockedError, TransientError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeLLMProvider, type FakeResponse } from "@rc/lib/providers/llm";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import { FIXTURE_OUTPUT, FIXTURE_PAGES } from "@rc/prompts/fixtures/knowledge-extractor";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { savePages } from "../ingestion";
import { extractBatch, insertBatches } from "./batch";
import {
  cutPdf,
  MAX_SUB_PDF_BYTES,
  PDF_PAGES_PER_BATCH,
  planPdfBatches,
  planTextBatches,
} from "./plan";
import { MAX_QUOTE_CHARS, validateExtraction } from "./validate";

const logger = createLogger({
  service: "jobs",
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

async function pdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);
  return doc.save();
}

describe("planTextBatches", () => {
  const pages = (n: number, chars: number) =>
    Array.from({ length: n }, (_, i) => ({ pageNumber: i + 1, charCount: chars }));

  it("packs pages up to about 12k tokens: 3 chars per token for Russian, 4 for Spanish", () => {
    // 12k tokens × 3 = 36,000 chars; pages of 10,000 chars → 3 per batch.
    expect(planTextBatches(pages(7, 10_000), "ru").map((b) => [b.pageStart, b.pageEnd])).toEqual([
      [1, 3],
      [4, 6],
      [7, 7],
    ]);
    // 12k × 4 = 48,000 chars → 4 pages per batch.
    expect(planTextBatches(pages(7, 10_000), "es").map((b) => [b.pageStart, b.pageEnd])).toEqual([
      [1, 4],
      [5, 7],
    ]);
    expect(planTextBatches(pages(2, 100), "ru")).toEqual([
      { batchIndex: 0, pageStart: 1, pageEnd: 2, mode: "TEXT" },
    ]);
  });

  it("puts an oversized page alone, keeps order, and handles no pages", () => {
    const planned = planTextBatches(
      [
        { pageNumber: 3, charCount: 100 },
        { pageNumber: 1, charCount: 100 },
        { pageNumber: 2, charCount: 100_000 },
        { pageNumber: 4, charCount: 100 },
      ],
      "ru",
    );
    expect(planned.map((b) => [b.batchIndex, b.pageStart, b.pageEnd])).toEqual([
      [0, 1, 1],
      [1, 2, 2],
      [2, 3, 4],
    ]);
    expect(planTextBatches([], "ru")).toEqual([]);
  });
});

describe("planPdfBatches", () => {
  const never = async () => {
    throw new Error("must not measure");
  };

  it("cuts 15-page PDF_NATIVE batches and does not measure files under the guard", async () => {
    expect(PDF_PAGES_PER_BATCH).toBe(15);
    const planned = await planPdfBatches(40, 10 * 1024 * 1024, never);
    expect(planned.map((b) => [b.batchIndex, b.pageStart, b.pageEnd, b.mode])).toEqual([
      [0, 1, 15, "PDF_NATIVE"],
      [1, 16, 30, "PDF_NATIVE"],
      [2, 31, 40, "PDF_NATIVE"],
    ]);
    expect(await planPdfBatches(0, 1, never)).toEqual([]);
  });

  it("measures a large file and halves ranges over 25 MB; a page that is still too big goes to TEXT", async () => {
    const MB = 1024 * 1024;
    // Page 5 alone is 30 MB, every other page 2 MB.
    const measure = async (start: number, end: number) =>
      (end - start + 1) * 2 * MB + (start <= 5 && 5 <= end ? 28 * MB : 0);
    const planned = await planPdfBatches(15, 100 * MB, measure);
    expect(planned.every((b) => b.pageEnd - b.pageStart + 1 <= 15)).toBe(true);
    const page5 = planned.find((b) => b.pageStart <= 5 && b.pageEnd >= 5);
    expect(page5).toMatchObject({ pageStart: 5, pageEnd: 5, mode: "TEXT" });
    expect(
      planned
        .filter((b) => b.mode === "PDF_NATIVE")
        .every((b) => !(b.pageStart <= 5 && b.pageEnd >= 5)),
    ).toBe(true);
    // Contiguous, complete, indexed in order.
    expect(planned.map((b) => b.batchIndex)).toEqual(planned.map((_, i) => i));
    const covered = planned.flatMap((b) =>
      Array.from({ length: b.pageEnd - b.pageStart + 1 }, (_, i) => b.pageStart + i),
    );
    expect(covered).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(MAX_SUB_PDF_BYTES).toBe(25 * MB);
  });
});

describe("cutPdf", () => {
  it("returns exactly the requested pages", async () => {
    const out = await PDFDocument.load(await cutPdf(await pdf(10), 4, 7));
    expect(out.getPageCount()).toBe(4);
  });
});

describe("validateExtraction", () => {
  const range = { pageStart: 1, pageEnd: 4 };
  const card = FIXTURE_OUTPUT.cards[0]!;
  const codes = (cards: object[], skippedPages: object[] = []) =>
    validateExtraction(
      { cards: cards.map((c) => ({ ...card, ...c })), skippedPages } as never,
      range,
    ).map((i) => i.code);

  it("accepts the fixture output", () => {
    expect(validateExtraction(FIXTURE_OUTPUT, range)).toEqual([]);
  });

  it("flags quote, confidence, page, safety and shape problems as blockers", () => {
    expect(codes([{ sourceQuote: "" }])).toEqual(["QUOTE_MISSING"]);
    expect(codes([{ sourceQuote: "x".repeat(MAX_QUOTE_CHARS + 1) }])).toEqual(["QUOTE_TOO_LONG"]);
    expect(codes([{ confidence: 1.5 }])).toEqual(["CONFIDENCE_RANGE"]);
    expect(codes([{ confidence: -0.1 }])).toEqual(["CONFIDENCE_RANGE"]);
    expect(codes([{ pageStart: 9, pageEnd: 9 }])).toEqual(["PAGE_OUT_OF_RANGE"]);
    expect(codes([{ pageStart: 3, pageEnd: 2 }])).toEqual(["PAGE_OUT_OF_RANGE"]);
    expect(codes([{ safetySensitive: true, safetyReason: " " }])).toEqual([
      "SAFETY_REASON_MISSING",
    ]);
    expect(codes([{ title: " ", claim: "" }])).toEqual(["EMPTY_FIELD", "EMPTY_FIELD"]);
    expect(codes([{ timings: [{ value: 10, valueMax: 5, unit: "min", context: "x" }] }])).toEqual([
      "FIELD_INVALID",
    ]);
    expect(codes([{ procedure: [{ n: 0, text: "x" }] }])).toEqual(["FIELD_INVALID"]);
  });

  it("reports the card index in the field path and only warns about skipped pages out of range", () => {
    const issues = validateExtraction(
      {
        cards: [card, { ...card, confidence: 2 }],
        skippedPages: [{ page: 99, reason: "MARKETING" }],
      },
      range,
    );
    expect(issues).toEqual([
      expect.objectContaining({ fieldPath: "cards.1.confidence", severity: "BLOCKER" }),
      expect.objectContaining({ code: "SKIPPED_PAGE_OUT_OF_RANGE", severity: "MINOR" }),
    ]);
  });
});

describe("extractBatch", () => {
  let t: TestDb;
  let storage: ReturnType<typeof createMemoryStorage>;
  let sourceId: string;
  let batchId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    storage = createMemoryStorage();
    const [brand] = await t.db.select().from(schema.brands);
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId: brand?.id ?? "",
        type: "GUIDE",
        title: "Крупы без каши (synthetic)",
        originalLanguage: "ru",
        sourceAuthor: "Test Author",
        rights,
        processingStatus: "PROCESSING",
        processingAttempt: 1,
        fileKey: "sources/s1/guide.pdf",
      })
      .returning();
    sourceId = source?.id ?? "";
    await storage.put("sources/s1/guide.pdf", await pdf(4), { contentType: "application/pdf" });
    const ctx = makeCtx(createFakeLLMProvider());
    await savePages(
      ctx,
      sourceId,
      1,
      FIXTURE_PAGES.map((p) => ({
        pageNumber: p.number,
        text: p.text,
        charCount: p.text.length,
        hasTextLayer: true,
        sectionPath: p.section,
      })),
    );
    const [batch] = await insertBatches(ctx, sourceId, 1, [
      { batchIndex: 0, pageStart: 1, pageEnd: 4, mode: "PDF_NATIVE" },
    ]);
    batchId = batch?.id ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  const makeCtx = (llm: ReturnType<typeof createFakeLLMProvider>) =>
    createServiceContext({
      db: t.db,
      logger,
      actor: { type: "JOB", jobRunId: "run_1" },
      llm,
      storage,
    });
  const scripted = (...responses: (FakeResponse | unknown)[]) =>
    createFakeLLMProvider({ handler: (_r, i) => responses[Math.min(i, responses.length - 1)] });
  const batchRow = async () => {
    const [row] = await t.db
      .select()
      .from(schema.knowledgeExtractionBatches)
      .where(eq(schema.knowledgeExtractionBatches.id, batchId));
    return row;
  };
  const cards = () =>
    t.db
      .select()
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.extractionBatchId, batchId))
      .orderBy(asc(schema.knowledgeItems.ordinalInBatch));
  const pdfPagesSent = (llm: ReturnType<typeof createFakeLLMProvider>, call = 0) => {
    const part = llm.calls[call]?.messages[0]?.content.find((c) => c.type === "pdf");
    return part && part.type === "pdf"
      ? PDFDocument.load(Buffer.from(part.base64, "base64")).then((d) => d.getPageCount())
      : undefined;
  };

  it("sends the batch pages as a PDF and stores validated cards", async () => {
    const llm = scripted(FIXTURE_OUTPUT);
    const outcome = await extractBatch(makeCtx(llm), { batchId });
    expect(outcome).toMatchObject({
      status: "SUCCEEDED",
      cardsCreated: 2,
      mode: "PDF_NATIVE",
      fallbackUsed: false,
    });

    expect(await pdfPagesSent(llm)).toBe(4);
    const request = llm.calls[0];
    expect(request).toMatchObject({
      stream: true,
      effort: "medium",
      maxTokens: 32_000,
      model: "claude-opus-5-5",
    });
    const text = JSON.stringify(request?.messages[0]?.content);
    expect(text).toContain("its first page is source page 1");
    expect(text).not.toContain("<pages>");
    // Categories come from taxonomy_terms.
    expect(text).toContain('<term code=\\"GRAINS_RICE_PASTA\\">');

    const stored = await cards();
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      title: "Гречка: не поднимать крышку",
      category: "GRAINS_RICE_PASTA",
      subcategory: "BUCKWHEAT",
      language: "ru",
      origin: "SOURCE_EXTRACTED",
      reviewStatus: "EXTRACTED",
      confidence: "0.95",
      sourceAssetId: sourceId,
      ordinalInBatch: 0,
      safetySensitive: false,
      reviewFlags: [],
      sourceReference: {
        pageStart: 2,
        pageEnd: 2,
        sectionPath: "Крупы без каши",
        quoteVerified: false,
      },
    });
    expect(stored[0]?.timingsJson).toEqual(FIXTURE_OUTPUT.cards[0]?.timings);
    expect(stored[1]).toMatchObject({
      ordinalInBatch: 1,
      safetySensitive: true,
      safetyNotes: "Хранение готового риса и рост бактерий.",
      reviewFlags: ["SAFETY_SENSITIVE"],
    });

    const row = await batchRow();
    expect(row).toMatchObject({
      status: "SUCCEEDED",
      cardsCreated: 2,
      mode: "PDF_NATIVE",
      error: null,
    });
    const [run] = await t.db.select().from(schema.generationRuns);
    expect(run).toMatchObject({
      id: row?.generationRunId,
      stage: "KNOWLEDGE_EXTRACTION",
      sourceAssetId: sourceId,
      triggerRunId: "run_1",
      inputRefs: { sourceAssetId: sourceId, pageRange: [1, 4] },
    });
    expect(JSON.stringify(run?.request)).not.toContain("JVBER"); // no PDF bytes
  });

  it("skips a SUCCEEDED batch on rerun without a model call or duplicate cards", async () => {
    await extractBatch(makeCtx(scripted(FIXTURE_OUTPUT)), { batchId });
    const llm = scripted(FIXTURE_OUTPUT);
    const again = await extractBatch(makeCtx(llm), { batchId });
    expect(again).toMatchObject({ status: "SUCCEEDED", cardsCreated: 2, runIds: [] });
    expect(llm.calls).toHaveLength(0);
    expect(await cards()).toHaveLength(2);
  });

  it("finishes a half-done batch: existing ordinals are kept, the rest inserted", async () => {
    const [brand] = await t.db.select().from(schema.brands);
    await t.db.insert(schema.knowledgeItems).values({
      brandId: brand?.id ?? "",
      title: "kept",
      category: "GRAINS_RICE_PASTA",
      claim: "kept",
      language: "ru",
      origin: "SOURCE_EXTRACTED",
      extractionBatchId: batchId,
      ordinalInBatch: 0,
      sourceAssetId: sourceId,
    });
    await t.db
      .update(schema.knowledgeExtractionBatches)
      .set({ status: "RUNNING" })
      .where(eq(schema.knowledgeExtractionBatches.id, batchId));
    const outcome = await extractBatch(makeCtx(scripted(FIXTURE_OUTPUT)), { batchId });
    expect(outcome).toMatchObject({ status: "SUCCEEDED", cardsCreated: 2 });
    expect((await cards()).map((c) => c.title)).toEqual(["kept", "Рис: остывание и хранение"]);
  });

  it("falls back to the page text when the API rejects the PDF", async () => {
    const llm = scripted(
      { error: new PermanentError("PDF could not be processed") },
      FIXTURE_OUTPUT,
    );
    const outcome = await extractBatch(makeCtx(llm), { batchId });
    expect(outcome).toMatchObject({
      status: "SUCCEEDED",
      cardsCreated: 2,
      mode: "TEXT",
      fallbackUsed: true,
    });
    expect(await pdfPagesSent(llm, 0)).toBe(4);
    expect(await pdfPagesSent(llm, 1)).toBeUndefined();
    const text = JSON.stringify(llm.calls[1]?.messages[0]?.content);
    expect(text).toContain('<page n=\\"2\\" section=\\"Крупы без каши\\">');
    expect((await batchRow())?.mode).toBe("TEXT");
    expect((await t.db.select().from(schema.generationRuns)).map((r) => r.status)).toEqual([
      "FAILED",
      "SUCCEEDED",
    ]);
  });

  it.each([
    ["invalid output twice", [{ cards: "no" }, { cards: "no" }, FIXTURE_OUTPUT]],
    ["a refusal", [{ refusal: { category: "cyber" } }, FIXTURE_OUTPUT]],
  ])("falls back to text after %s in PDF mode", async (_name, responses) => {
    const llm = scripted(...responses);
    const outcome = await extractBatch(makeCtx(llm), { batchId });
    expect(outcome).toMatchObject({ status: "SUCCEEDED", mode: "TEXT", fallbackUsed: true });
    expect(llm.calls).toHaveLength(responses.length);
  });

  it("falls back when the sub-PDF is over the size guard, without calling the model with it", async () => {
    const llm = scripted(FIXTURE_OUTPUT);
    const outcome = await extractBatch(makeCtx(llm), { batchId }, { maxPdfBytes: 10 });
    expect(outcome).toMatchObject({ status: "SUCCEEDED", mode: "TEXT", fallbackUsed: true });
    expect(llm.calls).toHaveLength(1);
    expect(await pdfPagesSent(llm)).toBeUndefined();
  });

  it("fails the batch, not the source, when the PDF fails and there is no text", async () => {
    await t.db.update(schema.sourcePages).set({ text: "", charCount: 0 });
    const llm = scripted({ error: new PermanentError("bad pdf") });
    const outcome = await extractBatch(makeCtx(llm), { batchId });
    expect(outcome).toMatchObject({
      status: "FAILED",
      reason: "PDF_FAILED_NO_TEXT",
      cardsCreated: 0,
    });
    expect(await batchRow()).toMatchObject({
      status: "FAILED",
      error: expect.objectContaining({ code: "PDF_FAILED_NO_TEXT" }),
    });
    expect(await cards()).toHaveLength(0);
    expect(
      (await t.db.select().from(schema.sourceAssets).where(eq(schema.sourceAssets.id, sourceId)))[0]
        ?.processingStatus,
    ).toBe("PROCESSING");
  });

  it("fails a TEXT batch whose extraction stays invalid and keeps the issues", async () => {
    await t.db
      .update(schema.knowledgeExtractionBatches)
      .set({ mode: "TEXT" })
      .where(eq(schema.knowledgeExtractionBatches.id, batchId));
    const bad = { cards: [{ ...FIXTURE_OUTPUT.cards[0], confidence: 3 }], skippedPages: [] };
    const llm = scripted(bad);
    const outcome = await extractBatch(makeCtx(llm), { batchId });
    expect(outcome).toMatchObject({
      status: "FAILED",
      reason: "INVALID_OUTPUT",
      fallbackUsed: false,
    });
    expect(llm.calls).toHaveLength(2); // first attempt + the one repair
    const row = await batchRow();
    expect(row?.error).toMatchObject({ code: "INVALID_OUTPUT" });
    expect(JSON.stringify(row?.error)).toContain("CONFIDENCE_RANGE");
    expect(await cards()).toHaveLength(0);
  });

  it("repairs a blocking validation problem with one new request and stores the fixed cards", async () => {
    const tooLong = {
      ...FIXTURE_OUTPUT,
      cards: [{ ...FIXTURE_OUTPUT.cards[0], sourceQuote: "я".repeat(401) }],
    };
    const llm = scripted(tooLong, FIXTURE_OUTPUT);
    const outcome = await extractBatch(makeCtx(llm), { batchId });
    expect(outcome).toMatchObject({ status: "SUCCEEDED", cardsCreated: 2, mode: "PDF_NATIVE" });
    expect(JSON.stringify(llm.calls[1]?.messages[0]?.content)).toContain("QUOTE_TOO_LONG");
    expect(outcome.runIds).toHaveLength(2);
  });

  it("marks the batch FAILED and rethrows a transient error; the next run recovers", async () => {
    const transient = new TransientError("overloaded");
    await expect(extractBatch(makeCtx(scripted({ error: transient })), { batchId })).rejects.toBe(
      transient,
    );
    expect(await batchRow()).toMatchObject({ status: "FAILED", error: { code: "EXTERNAL_ERROR" } });
    expect(await cards()).toHaveLength(0);

    const outcome = await extractBatch(makeCtx(scripted(FIXTURE_OUTPUT)), { batchId });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(await batchRow()).toMatchObject({ status: "SUCCEEDED", error: null });
  });

  it("refuses a source without AI rights before anything runs", async () => {
    await t.db
      .update(schema.sourceAssets)
      .set({ rights: { ...rights, aiProcessing: "DENIED" } })
      .where(eq(schema.sourceAssets.id, sourceId));
    const llm = scripted(FIXTURE_OUTPUT);
    await expect(extractBatch(makeCtx(llm), { batchId })).rejects.toBeInstanceOf(
      RightsBlockedError,
    );
    expect(llm.calls).toHaveLength(0);
    expect((await batchRow())?.status).toBe("PENDING");
  });

  it("skips a batch of an older processing attempt", async () => {
    await t.db
      .update(schema.sourceAssets)
      .set({ processingAttempt: 2 })
      .where(eq(schema.sourceAssets.id, sourceId));
    const llm = scripted(FIXTURE_OUTPUT);
    const outcome = await extractBatch(makeCtx(llm), { batchId });
    expect(outcome).toMatchObject({ status: "SKIPPED", reason: "STALE_ATTEMPT" });
    expect(llm.calls).toHaveLength(0);
    expect((await batchRow())?.status).toBe("SKIPPED");
  });

  it("inserts planned batches once per (source, attempt, index)", async () => {
    const ctx = makeCtx(createFakeLLMProvider());
    const planned = [
      { batchIndex: 0, pageStart: 1, pageEnd: 4, mode: "PDF_NATIVE" as const },
      { batchIndex: 1, pageStart: 5, pageEnd: 8, mode: "PDF_NATIVE" as const },
    ];
    const first = await insertBatches(ctx, sourceId, 1, planned);
    const second = await insertBatches(ctx, sourceId, 1, planned);
    expect(first.map((b) => b.id)).toEqual(second.map((b) => b.id));
    expect(second).toHaveLength(2);
    expect(await insertBatches(ctx, sourceId, 2, [])).toEqual([]);
    expect(
      await t.db
        .select()
        .from(schema.knowledgeExtractionBatches)
        .where(and(eq(schema.knowledgeExtractionBatches.sourceAssetId, sourceId))),
    ).toHaveLength(2);
  });
});
