import { schema } from "@rc/db";
import type { RightsPolicy, SourceReference } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError, RightsBlockedError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { groupPages, transcribeSourcePages, validateTranscription } from "./service";

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

describe("groupPages", () => {
  it("groups consecutive pages, at most five per group", () => {
    expect(groupPages([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 20])).toEqual([
      [1, 3],
      [5, 9],
      [10, 11],
      [20, 20],
    ]);
    expect(groupPages([3, 1, 2, 2])).toEqual([[1, 3]]);
    expect(groupPages([])).toEqual([]);
  });
});

describe("validateTranscription", () => {
  const entry = (page: number) => ({ page, text: "x", legible: true });
  const codes = (pages: number[]) =>
    validateTranscription({ pages: pages.map(entry) }, { pageStart: 4, pageEnd: 6 }).map(
      (i) => i.code,
    );
  it("wants every page of the range exactly once and nothing else", () => {
    expect(codes([4, 5, 6])).toEqual([]);
    expect(codes([4, 6])).toEqual(["PAGE_MISSING"]);
    expect(codes([4, 5, 5, 6])).toEqual(["PAGE_REPEATED"]);
    expect(codes([4, 5, 6, 9])).toEqual(["PAGE_OUT_OF_RANGE"]);
  });
});

describe("transcribeSourcePages (J19)", () => {
  let t: TestDb;
  let brandId: string;
  let sourceId: string;
  let ctx: ServiceContext;
  let calls: { pages: number[]; pdfPages: number }[];
  let respond: (range: [number, number], call: number) => unknown;

  const scanText: Record<number, string> = {
    2: "Гречку заливают водой 1:2 и варят 15 минут при слабом огне.",
    5: "Рис остужают тонким слоем.",
  };

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    calls = [];
    respond = ([start, end]) => ({
      pages: Array.from({ length: end - start + 1 }, (_, i) => ({
        page: start + i,
        text: scanText[start + i] ?? "",
        legible: true,
      })),
    });
    const storage = createMemoryStorage();
    const llm = createFakeLLMProvider({
      handler: (request, call) => {
        const text = JSON.stringify(request.messages);
        const m = text.match(/source pages? (\d+)(?:–(\d+))?/);
        const start = Number(m?.[1]);
        const end = Number(m?.[2] ?? m?.[1]);
        const pdf = request.messages[0]?.content.find((c) => c.type === "pdf");
        calls.push({ pages: [start, end], pdfPages: pdf ? 1 : 0 });
        return respond([start, end], call);
      },
    });
    ctx = createServiceContext({
      db: t.db,
      logger,
      llm,
      storage,
      actor: { type: "SYSTEM" },
    });

    const doc = await PDFDocument.create();
    for (let i = 0; i < 8; i++) doc.addPage([200, 200]);
    const bytes = await doc.save();
    await storage.put("sources/scan.pdf", bytes, { contentType: "application/pdf" });
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId,
        type: "BOOK",
        title: "Скан книги",
        fileKey: "sources/scan.pdf",
        originalFilename: "scan.pdf",
        originalLanguage: "ru",
        rights,
        processingAttempt: 1,
        processingStatus: "READY",
      })
      .returning();
    sourceId = source?.id ?? "";
    // Pages 1, 2, 4, 5, 6, 7, 8 are scans; page 3 has a text layer.
    await t.db.insert(schema.sourcePages).values(
      Array.from({ length: 8 }, (_, i) => ({
        sourceAssetId: sourceId,
        pageNumber: i + 1,
        text: i === 2 ? "Страница с текстовым слоем." : "",
        charCount: i === 2 ? 27 : 0,
        hasTextLayer: i === 2,
        processingAttempt: 1,
      })),
    );
  });
  afterEach(async () => {
    await t.close();
  });

  const ref = (over: Partial<SourceReference> = {}): SourceReference => ({
    pageStart: 2,
    pageEnd: 2,
    quote: "Гречку заливают водой 1:2",
    quoteVerified: false,
    note: "quote not found in the cited pages (best match 0.00)",
    ...over,
  });
  const addCard = async (over: Partial<typeof schema.knowledgeItems.$inferInsert> = {}) => {
    const [row] = await t.db
      .insert(schema.knowledgeItems)
      .values({
        brandId,
        title: "Гречка",
        category: "GRAINS_RICE_PASTA",
        claim: "Гречку варят 15 минут.",
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "NEEDS_REVIEW",
        sourceAssetId: sourceId,
        sourceReference: ref(),
        reviewFlags: ["QUOTE_UNVERIFIED", "LOW_CONFIDENCE"],
        confidence: "0.90",
        timingsJson: [{ value: 15, unit: "min", context: "варка" }],
        ...over,
      })
      .returning();
    return row?.id ?? "";
  };
  const card = async (id: string) => {
    const [row] = await t.db
      .select()
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.id, id));
    if (!row) throw new Error("missing");
    return row;
  };
  const page = async (n: number) => {
    const [row] = await t.db
      .select()
      .from(schema.sourcePages)
      .where(eq(schema.sourcePages.pageNumber, n));
    return row;
  };

  it("transcribes the scanned pages in groups of consecutive pages, with the pages attached", async () => {
    const result = await transcribeSourcePages(ctx, { sourceAssetId: sourceId });
    expect(calls.map((c) => c.pages)).toEqual([
      [1, 2],
      [4, 8],
    ]);
    expect(calls.every((c) => c.pdfPages === 1)).toBe(true);
    expect(result).toMatchObject({ transcribed: 7, illegible: [], failed: [] });
    expect(await page(2)).toMatchObject({
      text: scanText[2],
      charCount: (scanText[2] ?? "").length,
      transcribed: true,
      hasTextLayer: false,
    });
    // The page with a text layer is untouched.
    expect(await page(3)).toMatchObject({
      text: "Страница с текстовым слоем.",
      transcribed: false,
    });
    const runs = await t.db.select().from(schema.generationRuns);
    expect(runs.map((r) => r.stage)).toEqual(["PAGE_TRANSCRIPTION", "PAGE_TRANSCRIPTION"]);
    const events = await t.db.select().from(schema.auditEvents);
    expect(events.map((e) => e.action)).toContain("source.pages_transcribed");
  });

  it("checks the quote and the numbers of cards in review again, and leaves approved cards alone", async () => {
    const review = await addCard();
    const approved = await addCard({
      title: "Гречка (утверждена)",
      reviewStatus: "CHEF_APPROVED",
    });
    const farAway = await addCard({
      title: "Дальняя",
      sourceReference: ref({ pageStart: 8, pageEnd: 8, quote: "нет такого текста" }),
    });
    const result = await transcribeSourcePages(ctx, { sourceAssetId: sourceId });
    expect(result.quotesVerified).toBe(1);
    const fixed = await card(review);
    expect(fixed.reviewFlags).toEqual([]);
    expect(fixed.sourceReference).toMatchObject({
      quoteVerified: true,
      matchScore: 1,
      note: expect.stringContaining("quote found after page transcription"),
    });
    // Approved: as the chef left it.
    expect((await card(approved)).reviewFlags).toEqual(["QUOTE_UNVERIFIED", "LOW_CONFIDENCE"]);
    // A quote that is still not there stays flagged.
    expect((await card(farAway)).reviewFlags).toContain("QUOTE_UNVERIFIED");
  });

  it("does it once: pages that are done are not sent again", async () => {
    await transcribeSourcePages(ctx, { sourceAssetId: sourceId });
    const n = calls.length;
    expect(await transcribeSourcePages(ctx, { sourceAssetId: sourceId })).toMatchObject({
      transcribed: 0,
    });
    expect(calls).toHaveLength(n);
  });

  it("can be limited to some pages", async () => {
    await transcribeSourcePages(ctx, { sourceAssetId: sourceId, pages: [5, 3] });
    expect(calls.map((c) => c.pages)).toEqual([[5, 5]]);
  });

  it("reports pages the model could not read, and keeps an unreadable empty page open", async () => {
    respond = ([start, end]) => ({
      pages: Array.from({ length: end - start + 1 }, (_, i) => ({
        page: start + i,
        text: start + i === 5 ? "Рис остужают" : "",
        legible: start + i !== 5 && start + i !== 6,
      })),
    });
    const result = await transcribeSourcePages(ctx, { sourceAssetId: sourceId, pages: [4, 5, 6] });
    expect(result.illegible).toEqual([5, 6]);
    // Page 5: partly read, saved. Page 6: nothing read, stays open for another try.
    expect(await page(5)).toMatchObject({ text: "Рис остужают", transcribed: true });
    expect(await page(6)).toMatchObject({ text: "", transcribed: false });
    expect(await page(4)).toMatchObject({ transcribed: true });
  });

  it("reports a call whose answer cannot be used and goes on with the others", async () => {
    respond = ([start, end], call) =>
      call < 2
        ? { pages: [] } // missing pages twice: the repair does not help
        : {
            pages: Array.from({ length: end - start + 1 }, (_, i) => ({
              page: start + i,
              text: "т",
              legible: true,
            })),
          };
    const result = await transcribeSourcePages(ctx, { sourceAssetId: sourceId });
    expect(result.failed).toEqual([1, 2]);
    expect(result.transcribed).toBe(5);
    expect(await page(1)).toMatchObject({ transcribed: false });
  });

  it("does not send a source without AI rights, and ignores archived sources and non-PDF sources", async () => {
    await t.db
      .update(schema.sourceAssets)
      .set({ rights: { ...rights, aiProcessing: "DENIED" } })
      .where(eq(schema.sourceAssets.id, sourceId));
    await expect(transcribeSourcePages(ctx, { sourceAssetId: sourceId })).rejects.toThrow(
      RightsBlockedError,
    );
    expect(calls).toEqual([]);
    await t.db
      .update(schema.sourceAssets)
      .set({ rights, originalFilename: "notes.docx" })
      .where(eq(schema.sourceAssets.id, sourceId));
    expect((await transcribeSourcePages(ctx, { sourceAssetId: sourceId })).transcribed).toBe(0);
    await expect(
      transcribeSourcePages(ctx, { sourceAssetId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow(NotFoundError);
  });
});
