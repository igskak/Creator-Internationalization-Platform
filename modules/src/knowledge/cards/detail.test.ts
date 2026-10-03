import { schema } from "@rc/db";
import type { KnowledgeSnapshot, RightsPolicy, SourceReference } from "@rc/db/json";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { getCardWithEvidence } from "./detail";

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
const snapshot = (title: string, claim: string): KnowledgeSnapshot => ({
  title,
  category: "TECHNIQUES",
  subcategory: null,
  claim,
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
});

describe("getCardWithEvidence", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let brandId: string;
  let sourceId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" } });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId,
        type: "GUIDE",
        title: "Гайд",
        originalLanguage: "ru",
        rights,
        fileKey: "sources/x/guide.pdf",
        originalFilename: "guide.pdf",
        processingStatus: "READY",
        processingAttempt: 2,
      })
      .returning();
    sourceId = source?.id ?? "";
    const page = (pageNumber: number, text: string) => ({
      sourceAssetId: sourceId,
      pageNumber,
      text,
      charCount: text.length,
      processingAttempt: 2,
    });
    await t.db
      .insert(schema.sourcePages)
      .values([
        page(1, "Первая страница."),
        page(2, "Вступление. Гречку варят 15 минут. Крышку не поднимают: пар доваривает крупу."),
        page(3, "Третья страница про рис."),
        page(4, "Четвёртая страница."),
      ]);
  });
  afterEach(async () => {
    await t.close();
  });

  const addCard = async (over: Partial<typeof schema.knowledgeItems.$inferInsert> = {}) => {
    const ref: SourceReference = {
      pageStart: 2,
      pageEnd: 2,
      quote: "Крышку не поднимают: пар доваривает крупу.",
      quoteVerified: true,
    };
    const [row] = await t.db
      .insert(schema.knowledgeItems)
      .values({
        brandId,
        title: "Гречка",
        category: "TECHNIQUES",
        claim: "Крышку не поднимают.",
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "NEEDS_REVIEW",
        confidence: "0.90",
        sourceAssetId: sourceId,
        sourceReference: ref,
        embedding: Array.from({ length: 1536 }, () => 0.1),
        ...over,
      })
      .returning();
    return row?.id ?? "";
  };

  it("returns the card without its vector, with the source and the cited page plus its neighbours", async () => {
    const id = await addCard();
    const detail = await getCardWithEvidence(ctx, id);
    expect(detail.card).toMatchObject({
      id,
      title: "Гречка",
      status: "NEEDS_REVIEW",
      confidence: 0.9,
      flags: [],
    });
    expect(detail.card).not.toHaveProperty("embedding");
    expect(detail.source).toEqual({
      id: sourceId,
      title: "Гайд",
      type: "GUIDE",
      hasFile: true,
      isPdf: true,
    });
    expect(detail.pages.map((p) => [p.pageNumber, p.cited])).toEqual([
      [1, false],
      [2, true],
      [3, false],
    ]);
    expect(detail.pages[1]?.text).toContain("Гречку варят 15 минут");
    expect(detail.usedByIdeas).toEqual([]);
    expect(detail.duplicateOf).toBeNull();
  });

  it("locates the quote on the cited page so it can be highlighted", async () => {
    const id = await addCard();
    const page = (await getCardWithEvidence(ctx, id)).pages.find((p) => p.cited);
    const range = page?.quoteRange;
    expect(range).not.toBeNull();
    expect(page?.text.slice(range?.start, range?.end)).toBe(
      "Крышку не поднимают: пар доваривает крупу.",
    );
  });

  it("gives no highlight when the quote is not on the page, and highlights it once for a card over two pages", async () => {
    const missing = await addCard({
      sourceReference: {
        pageStart: 2,
        pageEnd: 2,
        quote: "Этого нет в тексте",
        quoteVerified: false,
      },
    });
    expect(
      (await getCardWithEvidence(ctx, missing)).pages.every((p) => p.quoteRange === null),
    ).toBe(true);

    const spanning = await addCard({
      sourceReference: { pageStart: 2, pageEnd: 3, quote: "Третья страница", quoteVerified: true },
    });
    const pages = (await getCardWithEvidence(ctx, spanning)).pages;
    expect(pages.map((p) => [p.pageNumber, p.cited])).toEqual([
      [1, false],
      [2, true],
      [3, true],
      [4, false],
    ]);
    expect(pages.filter((p) => p.quoteRange).map((p) => p.pageNumber)).toEqual([3]);
  });

  it("handles a card on the first page and a manual card without a source", async () => {
    const first = await addCard({
      sourceReference: { pageStart: 1, pageEnd: 1, quote: "Первая страница.", quoteVerified: true },
    });
    expect((await getCardWithEvidence(ctx, first)).pages.map((p) => p.pageNumber)).toEqual([1, 2]);

    const manual = await addCard({ sourceAssetId: null, sourceReference: null, origin: "MANUAL" });
    const detail = await getCardWithEvidence(ctx, manual);
    expect(detail.source).toBeNull();
    expect(detail.pages).toEqual([]);
  });

  it("lists the version history newest first with who changed it", async () => {
    const [owner] = await t.db.select().from(schema.appUsers);
    const id = await addCard({ reviewStatus: "CHEF_APPROVED", approvedVersion: 2, version: 3 });
    await t.db.insert(schema.knowledgeItemVersions).values([
      {
        knowledgeItemId: id,
        version: 1,
        snapshot: snapshot("Гречка v1", "Старое утверждение"),
        status: "CHEF_APPROVED",
        changedBy: owner?.id ?? null,
        changeNote: "Первое утверждение",
      },
      {
        knowledgeItemId: id,
        version: 2,
        snapshot: snapshot("Гречка v2", "Новое утверждение"),
        status: "CHEF_APPROVED",
        changedBy: null,
      },
    ]);
    const { versions } = await getCardWithEvidence(ctx, id);
    expect(versions.map((v) => [v.version, v.title, v.claim, v.changedBy, v.changeNote])).toEqual([
      [2, "Гречка v2", "Новое утверждение", null, null],
      [1, "Гречка v1", "Старое утверждение", "owner@example.com", "Первое утверждение"],
    ]);
  });

  it("names the card it may duplicate and reports unknown ids", async () => {
    const older = await addCard({ title: "Первая" });
    const dup = await addCard({
      title: "Копия",
      duplicateOfId: older,
      reviewFlags: ["DUPLICATE_SUSPECTED"],
    });
    const detail = await getCardWithEvidence(ctx, dup);
    expect(detail.duplicateOf).toEqual({ id: older, title: "Первая" });
    expect(detail.card.flags).toEqual(["DUPLICATE_SUSPECTED"]);
    await expect(
      getCardWithEvidence(ctx, "11111111-1111-4111-8111-111111111111"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("says when the source has no file to open", async () => {
    await t.db.update(schema.sourceAssets).set({ fileKey: null });
    const id = await addCard();
    expect((await getCardWithEvidence(ctx, id)).source).toMatchObject({ hasFile: false });
  });
});
