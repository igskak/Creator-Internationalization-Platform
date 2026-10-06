import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { asc, eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import {
  ForbiddenError,
  InvalidStateError,
  RightsBlockedError,
  TransientError,
} from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider, type FakeResponse } from "@rc/lib/providers/llm";
import { createMemoryStorage, type StorageProvider } from "@rc/lib/providers/storage";
import { FIXTURE_OUTPUT, FIXTURE_PAGES } from "@rc/prompts/fixtures/knowledge-extractor";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInlineJobRunner, createServiceContext, type ServiceContext } from "../core";
import { jobHandlers } from "../job-handlers";
import { ingestSource } from "./ingest-source";
import {
  completeSourceUpload,
  createSourceUpload,
  reprocessSource,
  updateSourceRights,
} from "./sources";

// End to end through the inline job runner: upload → complete → ingest-source → extraction
// batches → cards in the review queue. Synthetic content only.

const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});
const allowed: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "UNKNOWN",
};
const unknownRights: RightsPolicy = { ...allowed, aiProcessing: "UNKNOWN" };
const enc = (s: string) => new TextEncoder().encode(s);

/** The fixture pages as Markdown: every heading starts a page, so page numbers match the fixture. */
const MARKDOWN = [
  "# Содержание",
  "",
  FIXTURE_PAGES[0].text.split("\n").slice(1).join("\n"),
  "",
  "# Крупы без каши",
  "",
  FIXTURE_PAGES[1].text,
  "",
  "# Хранение готовых блюд",
  "",
  FIXTURE_PAGES[2].text,
  "",
  "# Курсы",
  "",
  FIXTURE_PAGES[3].text,
].join("\n");

const LATIN =
  "Salt the water before it boils so the grains season evenly while they cook. Keep the lid slightly open and stir only twice. Rest the pot off the heat for ten minutes. Fluff with a fork, never a spoon, so the grains stay separate and light on the plate.";
async function latinPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText(LATIN, { x: 40, y: 700, size: 11, font, maxWidth: 500, lineHeight: 14 });
  return doc.save();
}
const LATIN_OUTPUT = {
  cards: [
    {
      ...FIXTURE_OUTPUT.cards[0],
      title: "Lid and stirring",
      category: "TECHNIQUES",
      subcategory: undefined,
      claim: "Stir only twice and keep the lid slightly open.",
      explanation: "",
      procedure: [],
      ingredients: [],
      timings: [],
      commonMistakes: [],
      sourceQuote: "Keep the lid slightly open and stir only twice.",
      pageStart: 1,
      pageEnd: 1,
      sectionHint: undefined,
    },
  ],
  skippedPages: [],
};

describe("ingest-source (inline, end to end)", () => {
  let t: TestDb;
  let storage: ReturnType<typeof createMemoryStorage>;
  let owner: ServiceContext;
  let getStreamCalls: number;
  let llmCalls: number;

  const wrapStorage = (inner: StorageProvider): StorageProvider => ({
    ...inner,
    getStream: (key) => {
      getStreamCalls += 1;
      return inner.getStream(key);
    },
  });

  function build(
    handler: (index: number) => FakeResponse | unknown,
    embeddings = createFakeEmbeddingProvider(),
  ) {
    llmCalls = 0;
    const llm = createFakeLLMProvider({ handler: () => handler(llmCalls++) });
    const store = wrapStorage(storage);
    const runner: ReturnType<typeof createInlineJobRunner> = createInlineJobRunner({
      handlers: jobHandlers,
      mode: "await",
      makeContext: (runId) =>
        createServiceContext({
          db: t.db,
          logger,
          actor: { type: "JOB", jobRunId: runId },
          llm,
          embeddings,
          storage: store,
          jobs: runner,
        }),
    });
    return { llm, jobs: runner, store, embeddings };
  }

  let ownerId = "";
  const ctxFor = (
    harness: ReturnType<typeof build>,
    role: "owner" | "editor" | "chef" = "owner",
  ): ServiceContext =>
    createServiceContext({
      db: t.db,
      logger,
      actor: { type: "USER", userId: ownerId, role },
      llm: harness.llm,
      embeddings: harness.embeddings,
      storage: harness.store,
      jobs: harness.jobs,
    });

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [row] = await t.db.select().from(schema.appUsers);
    ownerId = row?.id ?? "";
    storage = createMemoryStorage();
    getStreamCalls = 0;
  });
  afterEach(async () => {
    await t.close();
  });

  const upload = async (
    ctx: ServiceContext,
    file: {
      name: string;
      mime: string;
      bytes: Uint8Array;
      rights?: RightsPolicy;
      type?: "GUIDE" | "NOTE";
    },
  ) => {
    const { sourceAssetId } = await createSourceUpload(ctx, {
      type: file.type ?? "GUIDE",
      title: file.name,
      fileName: file.name,
      mimeType: file.mime,
      sizeBytes: file.bytes.length,
      originalLanguage: file.name.endsWith(".pdf") ? "en" : "ru",
      rights: file.rights ?? allowed,
    });
    const row = await source(sourceAssetId);
    await storage.put(row.fileKey ?? "", file.bytes, { contentType: file.mime });
    return sourceAssetId;
  };
  const source = async (id: string) => {
    const [row] = await t.db
      .select()
      .from(schema.sourceAssets)
      .where(eq(schema.sourceAssets.id, id));
    if (!row) throw new Error("missing source");
    return row;
  };
  const cardsOf = (id: string) =>
    t.db
      .select()
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.sourceAssetId, id))
      .orderBy(asc(schema.knowledgeItems.createdAt), asc(schema.knowledgeItems.ordinalInBatch));
  const actions = async () =>
    (await t.db.select().from(schema.auditEvents).orderBy(asc(schema.auditEvents.id))).map(
      (e) => e.action,
    );
  const markdown = { name: "guide.md", mime: "text/markdown", bytes: enc(MARKDOWN) };

  it("takes a Markdown source from upload to cards in the review queue", async () => {
    const h = build(() => FIXTURE_OUTPUT);
    const ctx = ctxFor(h);
    const id = await upload(ctx, markdown);
    expect(await completeSourceUpload(ctx, { sourceAssetId: id })).toEqual({ status: "QUEUED" });

    const row = await source(id);
    expect(row).toMatchObject({
      processingStatus: "READY",
      pageCount: 4,
      checksumSha256: createHash("sha256").update(markdown.bytes).digest("hex"),
      fileSizeBytes: markdown.bytes.length,
      processingError: null,
      processingProgress: {
        stage: "DONE",
        pagesTotal: 4,
        batchesTotal: 1,
        batchesDone: 1,
        cardsCreated: 2,
      },
    });
    const pages = await t.db
      .select()
      .from(schema.sourcePages)
      .where(eq(schema.sourcePages.sourceAssetId, id));
    expect(pages.map((p) => [p.pageNumber, p.sectionPath, p.processingAttempt]).sort()).toEqual([
      [1, "Содержание", 1],
      [2, "Крупы без каши", 1],
      [3, "Хранение готовых блюд", 1],
      [4, "Курсы", 1],
    ]);
    const batches = await t.db.select().from(schema.knowledgeExtractionBatches);
    expect(batches).toEqual([
      expect.objectContaining({
        mode: "TEXT",
        status: "SUCCEEDED",
        pageStart: 1,
        pageEnd: 4,
        cardsCreated: 2,
      }),
    ]);
    const cards = await cardsOf(id);
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.reviewStatus === "NEEDS_REVIEW")).toBe(true);
    expect(cards[0]?.sourceReference).toMatchObject({ quoteVerified: true, matchScore: 1 });
    expect(cards[1]).toMatchObject({ safetySensitive: true, reviewFlags: ["SAFETY_SENSITIVE"] });
    // Status changes of the batch and the cards go through the same helper; the named events are:
    const log = await actions();
    expect(log.filter((a) => !a.endsWith("status_changed"))).toEqual([
      "source.uploaded",
      "source.processing_started",
      "knowledge.needs_review",
      "knowledge.needs_review",
      "source.processed",
    ]);
  });

  it("embeds the new cards after READY and flags a duplicate pair", async () => {
    const [first, second] = FIXTURE_OUTPUT.cards;
    // The writer returned the first card twice (same text, so the same vector).
    const h = build(() => ({ ...FIXTURE_OUTPUT, cards: [first, second, first] }));
    const ctx = ctxFor(h);
    const id = await upload(ctx, markdown);
    await completeSourceUpload(ctx, { sourceAssetId: id });

    expect((await source(id)).processingStatus).toBe("READY");
    const cards = await cardsOf(id);
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.embedding).toHaveLength(1536);
      expect(card.embeddingModel).toBe("fake-embedding");
      expect(card.embeddingHash).toMatch(/^[0-9a-f]{64}$/);
    }
    const flagged = cards.filter((c) => c.reviewFlags.includes("DUPLICATE_SUSPECTED"));
    expect(flagged).toHaveLength(1);
    const twins = cards.filter((c) => c.title === first?.title).map((c) => c.id);
    expect(twins).toContain(flagged[0]?.id);
    expect(twins).toContain(flagged[0]?.duplicateOfId);
    // One call for the cards, one for the source chunks (M1-21).
    expect(h.embeddings.calls).toHaveLength(2);
    const chunks = await t.db
      .select()
      .from(schema.sourceChunks)
      .where(eq(schema.sourceChunks.sourceAssetId, id));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.embedding?.length === 1536 && c.language === "ru")).toBe(true);
  });

  it("stays READY when the vectors cannot be made; the backfill job catches up later", async () => {
    const failing = createFakeEmbeddingProvider();
    failing.embed = async () => {
      throw new TransientError("embeddings down");
    };
    const h = build(() => FIXTURE_OUTPUT, failing);
    const ctx = ctxFor(h);
    const id = await upload(ctx, markdown);
    await completeSourceUpload(ctx, { sourceAssetId: id });
    expect((await source(id)).processingStatus).toBe("READY");
    expect((await cardsOf(id)).every((c) => c.embedding === null)).toBe(true);
    // Source search is optional: no chunks, and the source is still READY.
    expect(await t.db.select().from(schema.sourceChunks)).toEqual([]);

    const healthy = build(() => FIXTURE_OUTPUT);
    await healthy.jobs.trigger("embed-knowledge-items", {});
    expect((await cardsOf(id)).every((c) => c.embedding !== null)).toBe(true);
  });

  it("extracts a PDF through PDF_NATIVE batches", async () => {
    const h = build(() => LATIN_OUTPUT);
    const ctx = ctxFor(h);
    const id = await upload(ctx, {
      name: "guide.pdf",
      mime: "application/pdf",
      bytes: await latinPdf(),
    });
    await completeSourceUpload(ctx, { sourceAssetId: id });
    expect((await source(id)).processingStatus).toBe("READY");
    const [batch] = await t.db.select().from(schema.knowledgeExtractionBatches);
    expect(batch).toMatchObject({
      mode: "PDF_NATIVE",
      status: "SUCCEEDED",
      pageStart: 1,
      pageEnd: 1,
    });
    const [card] = await cardsOf(id);
    expect(card?.sourceReference).toMatchObject({ quoteVerified: true });
    expect(h.llm.id).toBe("fake");
  });

  it("blocks a source without AI rights, then runs it once the owner confirms the rights", async () => {
    const h = build(() => FIXTURE_OUTPUT);
    const ctx = ctxFor(h);
    const id = await upload(ctx, { ...markdown, rights: unknownRights });
    expect(await completeSourceUpload(ctx, { sourceAssetId: id })).toEqual({ status: "BLOCKED" });
    expect(llmCalls).toBe(0);

    await updateSourceRights(ctx, { sourceAssetId: id, rights: allowed, rightsStatus: "CLEARED" });
    const row = await source(id);
    expect(row.processingStatus).toBe("READY");
    expect(row.rights).toMatchObject({ aiProcessing: "ALLOWED", confirmedBy: ownerId });
    expect(await cardsOf(id)).toHaveLength(2);
  });

  it("re-checks the gate: a source whose rights were withdrawn is BLOCKED and the job throws", async () => {
    const h = build(() => FIXTURE_OUTPUT);
    const ctx = ctxFor(h);
    const id = await upload(ctx, markdown);
    await t.db
      .update(schema.sourceAssets)
      .set({
        processingStatus: "QUEUED",
        processingAttempt: 1,
        rights: { ...allowed, aiProcessing: "DENIED" },
      })
      .where(eq(schema.sourceAssets.id, id));
    await expect(ingestSource(ctx, { sourceAssetId: id, attempt: 1 })).rejects.toBeInstanceOf(
      RightsBlockedError,
    );
    expect((await source(id)).processingStatus).toBe("BLOCKED");
    expect(llmCalls).toBe(0);
    expect(await actions()).toContain("source.blocked");
  });

  it("fails a duplicate file with a link to the first source", async () => {
    const h = build(() => FIXTURE_OUTPUT);
    const ctx = ctxFor(h);
    const first = await upload(ctx, markdown);
    await completeSourceUpload(ctx, { sourceAssetId: first });
    const second = await upload(ctx, { ...markdown, name: "copy.md" });
    await completeSourceUpload(ctx, { sourceAssetId: second });

    const row = await source(second);
    expect(row.processingStatus).toBe("FAILED");
    expect(row.processingError).toMatchObject({
      code: "DUPLICATE_SOURCE",
      details: { duplicateOfId: first },
    });
    expect(row.checksumSha256).toBeNull();
    expect(await cardsOf(second)).toHaveLength(0);
    expect(llmCalls).toBe(1); // only the first source reached the model
  });

  it("fails a file whose content does not match its type, with a clear code", async () => {
    const h = build(() => FIXTURE_OUTPUT);
    const ctx = ctxFor(h);
    const id = await upload(ctx, {
      name: "fake.pdf",
      mime: "application/pdf",
      bytes: enc("just text"),
    });
    await completeSourceUpload(ctx, { sourceAssetId: id });
    const row = await source(id);
    expect(row).toMatchObject({
      processingStatus: "FAILED",
      processingError: { code: "TYPE_MISMATCH" },
    });
    expect(await actions()).toContain("source.failed");
    expect(llmCalls).toBe(0);
  });

  describe("several batches", () => {
    // 3 sections of about 20,000 characters: ~21 pages of 3,000 characters, 2 text batches.
    const long = ["# А", "# Б", "# В"]
      .map(
        (h, i) =>
          `${h}\n\n${Array.from({ length: 60 }, (_, k) => `Абзац ${i}-${k}: ${"соль и вода ".repeat(27)}`).join("\n\n")}`,
      )
      .join("\n\n");
    const longFile = { name: "long.md", mime: "text/markdown", bytes: enc(long) };

    it("finishes READY with the failed batches listed when at least one batch worked", async () => {
      const h = build((i) => (i === 0 ? FIXTURE_OUTPUT : { cards: "invalid" }));
      const ctx = ctxFor(h);
      const id = await upload(ctx, longFile);
      await completeSourceUpload(ctx, { sourceAssetId: id });

      const row = await source(id);
      expect(row.processingStatus).toBe("READY");
      expect(row.processingProgress).toMatchObject({
        stage: "DONE",
        batchesTotal: 2,
        batchesDone: 1,
        cardsCreated: 2,
        failedBatches: [expect.objectContaining({ batchIndex: 1, code: "INVALID_OUTPUT" })],
      });
      const batches = await t.db
        .select()
        .from(schema.knowledgeExtractionBatches)
        .orderBy(asc(schema.knowledgeExtractionBatches.batchIndex));
      expect(batches.map((b) => b.status)).toEqual(["SUCCEEDED", "FAILED"]);
      expect(await cardsOf(id)).toHaveLength(2);
    });

    it("fails the source when no batch could be extracted", async () => {
      const h = build(() => ({ error: new TransientError("overloaded") }));
      const ctx = ctxFor(h);
      const id = await upload(ctx, longFile);
      await completeSourceUpload(ctx, { sourceAssetId: id });
      const row = await source(id);
      expect(row).toMatchObject({
        processingStatus: "FAILED",
        processingError: { code: "ALL_BATCHES_FAILED" },
      });
      expect(row.processingProgress).toMatchObject({
        batchesDone: 0,
        failedBatches: expect.any(Array),
      });
      expect(await cardsOf(id)).toHaveLength(0);
      expect(await actions()).toContain("source.failed");
    });
  });

  it("skips stale, finished and archived runs, and resumes a PROCESSING source", async () => {
    const h = build(() => FIXTURE_OUTPUT);
    const ctx = ctxFor(h);
    const id = await upload(ctx, markdown);
    await completeSourceUpload(ctx, { sourceAssetId: id });
    expect(await ingestSource(ctx, { sourceAssetId: id, attempt: 1 })).toEqual({
      status: "SKIPPED",
      reason: "ALREADY_DONE",
    });
    expect(await ingestSource(ctx, { sourceAssetId: id, attempt: 7 })).toEqual({
      status: "SKIPPED",
      reason: "STALE_ATTEMPT",
    });
    await t.db
      .update(schema.sourceAssets)
      .set({ archivedAt: new Date() })
      .where(eq(schema.sourceAssets.id, id));
    expect(await ingestSource(ctx, { sourceAssetId: id, attempt: 1 })).toEqual({
      status: "SKIPPED",
      reason: "ARCHIVED",
    });

    // A retried run: the source is already PROCESSING (the first run died after starting).
    const other = await upload(ctx, {
      ...markdown,
      name: "other.md",
      bytes: enc(`${MARKDOWN}\n\nДругой файл.`),
    });
    await t.db
      .update(schema.sourceAssets)
      .set({ processingStatus: "PROCESSING", processingAttempt: 1 })
      .where(eq(schema.sourceAssets.id, other));
    const outcome = await ingestSource(ctx, { sourceAssetId: other, attempt: 1 });
    expect(outcome).toMatchObject({ status: "READY", cardsCreated: 2 });

    const fresh = await upload(ctx, {
      ...markdown,
      name: "fresh.md",
      bytes: enc(`${MARKDOWN}\n\nЕщё файл.`),
    });
    await expect(ingestSource(ctx, { sourceAssetId: fresh, attempt: 0 })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
  });

  describe("reprocessSource", () => {
    it("FULL: new attempt, unapproved cards superseded, approved cards kept, new cards created", async () => {
      const h = build(() => FIXTURE_OUTPUT);
      const ctx = ctxFor(h);
      const id = await upload(ctx, markdown);
      await completeSourceUpload(ctx, { sourceAssetId: id });
      const [first, second] = await cardsOf(id);
      await t.db
        .update(schema.knowledgeItems)
        .set({ reviewStatus: "CHEF_APPROVED", approvedVersion: 1 })
        .where(eq(schema.knowledgeItems.id, first?.id ?? ""));

      const result = await reprocessSource(ctx, { sourceAssetId: id });
      expect(result.attempt).toBe(2);

      const row = await source(id);
      expect(row).toMatchObject({
        processingStatus: "READY",
        processingAttempt: 2,
        processingError: null,
      });
      const all = await cardsOf(id);
      const byId = new Map(all.map((c) => [c.id, c]));
      expect(byId.get(first?.id ?? "")?.reviewStatus).toBe("CHEF_APPROVED");
      expect(byId.get(second?.id ?? "")).toMatchObject({
        reviewStatus: "ARCHIVED",
        archiveReason: "SUPERSEDED",
      });
      const fresh = all.filter((c) => c.id !== first?.id && c.id !== second?.id);
      expect(fresh).toHaveLength(2);
      expect(fresh.every((c) => c.reviewStatus === "NEEDS_REVIEW")).toBe(true);
      const pages = await t.db
        .select()
        .from(schema.sourcePages)
        .where(eq(schema.sourcePages.sourceAssetId, id));
      expect(pages.every((p) => p.processingAttempt === 2)).toBe(true);
      const batches = await t.db.select().from(schema.knowledgeExtractionBatches);
      expect(batches.map((b) => b.processingAttempt).sort()).toEqual([1, 2]);
      expect(await actions()).toContain("source.reprocessed");
    });

    it("KNOWLEDGE_ONLY: keeps the pages and does not read the file again", async () => {
      const h = build(() => FIXTURE_OUTPUT);
      const ctx = ctxFor(h);
      const id = await upload(ctx, markdown);
      await completeSourceUpload(ctx, { sourceAssetId: id });
      const readsAfterFirstRun = getStreamCalls;
      expect(readsAfterFirstRun).toBeGreaterThan(0);

      await reprocessSource(ctx, { sourceAssetId: id, mode: "KNOWLEDGE_ONLY" });
      expect(getStreamCalls).toBe(readsAfterFirstRun);
      expect((await source(id)).processingStatus).toBe("READY");
      const pages = await t.db
        .select()
        .from(schema.sourcePages)
        .where(eq(schema.sourcePages.sourceAssetId, id));
      expect(pages).toHaveLength(4);
      expect(pages.every((p) => p.processingAttempt === 2)).toBe(true);
      expect((await cardsOf(id)).filter((c) => c.reviewStatus === "NEEDS_REVIEW")).toHaveLength(2);
    });

    it("refuses sources that are not READY or FAILED, roles without access, and unconfirmed rights", async () => {
      const h = build(() => FIXTURE_OUTPUT);
      const ctx = ctxFor(h);
      const id = await upload(ctx, markdown);
      await expect(reprocessSource(ctx, { sourceAssetId: id })).rejects.toBeInstanceOf(
        InvalidStateError,
      ); // PENDING_UPLOAD
      await completeSourceUpload(ctx, { sourceAssetId: id });
      await expect(
        reprocessSource(ctxFor(h, "chef"), { sourceAssetId: id }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await t.db
        .update(schema.sourceAssets)
        .set({ processingStatus: "PROCESSING" })
        .where(eq(schema.sourceAssets.id, id));
      await expect(reprocessSource(ctx, { sourceAssetId: id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      expect(await cardsOf(id)).toHaveLength(2); // nothing was archived

      await t.db
        .update(schema.sourceAssets)
        .set({ processingStatus: "FAILED", rights: unknownRights })
        .where(eq(schema.sourceAssets.id, id));
      await expect(reprocessSource(ctx, { sourceAssetId: id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      await expect(
        reprocessSource(ctxFor(h, "editor"), {
          sourceAssetId: "11111111-1111-4111-8111-111111111111",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
