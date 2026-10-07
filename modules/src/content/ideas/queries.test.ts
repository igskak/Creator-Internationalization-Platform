import { schema } from "@rc/db";
import type { KnowledgeSnapshot, RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { getIdeaDetail, listActiveProducts, listIdeas, searchCardsForIdea } from "./queries";

// Synthetic content only.
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

describe("idea queries", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let brandId: string;
  let sourceId: string;
  let n = 0;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" } });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({ brandId, type: "GUIDE", title: "Guide to grains", originalLanguage: "ru", rights })
      .returning();
    sourceId = source?.id ?? "";
    n = 0;
  });
  afterEach(async () => {
    await t.close();
  });

  const snapshot = (title: string): KnowledgeSnapshot => ({
    title,
    category: "GRAINS_RICE_PASTA",
    subcategory: null,
    claim: `Утверждение: ${title}`,
    explanation: "Пояснение",
    procedure: [],
    ingredients: [],
    temperatures: [],
    timings: [],
    commonMistakes: [],
    sourceReference: { pageStart: 7, quote: "точная цитата", quoteVerified: true },
    language: "ru",
    safetySensitive: false,
    safetyNotes: null,
    tags: [],
  });
  const addCard = async (over: Partial<typeof schema.knowledgeItems.$inferInsert> = {}) => {
    n += 1;
    const [row] = await t.db
      .insert(schema.knowledgeItems)
      .values({
        brandId,
        title: `Карточка ${n}`,
        category: "GRAINS_RICE_PASTA",
        claim: `Утверждение ${n}`,
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "CHEF_APPROVED",
        approvedVersion: 2,
        approvedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, n)),
        sourceAssetId: sourceId,
        ...over,
      })
      .returning();
    return row?.id ?? "";
  };
  const addIdea = async (
    over: Partial<typeof schema.masterIdeas.$inferInsert> = {},
    cards: { id: string; role?: "PRIMARY" | "SUPPORTING"; version?: number }[] = [],
  ) => {
    const [row] = await t.db
      .insert(schema.masterIdeas)
      .values({
        brandId,
        topic: "Тема",
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "Core message.",
        origin: "MANUAL",
        ...over,
      })
      .returning();
    const id = row?.id ?? "";
    for (const card of cards) {
      await t.db
        .insert(schema.knowledgeItemVersions)
        .values({
          knowledgeItemId: card.id,
          version: card.version ?? 2,
          snapshot: snapshot(`Версия ${card.id.slice(0, 4)}`),
          status: "CHEF_APPROVED",
        })
        .onConflictDoNothing();
      await t.db.insert(schema.masterIdeaKnowledge).values({
        masterIdeaId: id,
        knowledgeItemId: card.id,
        knowledgeVersion: card.version ?? 2,
        role: card.role ?? "PRIMARY",
      });
    }
    return id;
  };

  describe("listIdeas", () => {
    it("lists one status newest first with card counts, product names and per-status counts", async () => {
      const [a, b] = [await addCard(), await addCard()] as [string, string];
      const [product] = await t.db
        .insert(schema.products)
        .values({ brandId, code: "G", name: "Grain guide", type: "GUIDE", originalLanguage: "ru" })
        .returning();
      await addIdea({ topic: "old", createdAt: new Date("2026-10-01T00:00:00Z") }, [{ id: a }]);
      await addIdea(
        {
          topic: "new",
          createdAt: new Date("2026-10-05T00:00:00Z"),
          productId: product?.id ?? null,
          commercialIntent: "LEAD_MAGNET",
          origin: "AI_GENERATED",
        },
        [{ id: a }, { id: b, role: "SUPPORTING" }],
      );
      await addIdea({ topic: "rejected", status: "REJECTED" });
      const list = await listIdeas(ctx);
      expect(
        list.rows.map((r) => [r.topic, r.cardCount, r.productName, r.origin, r.commercialIntent]),
      ).toEqual([
        ["new", 2, "Grain guide", "AI_GENERATED", "LEAD_MAGNET"],
        ["old", 1, null, "MANUAL", "NONE"],
      ]);
      expect(list).toMatchObject({
        total: 2,
        page: 1,
        statusCounts: { PROPOSED: 2, ACCEPTED: 0, REJECTED: 1, ARCHIVED: 0 },
      });
      expect((await listIdeas(ctx, { status: "REJECTED" })).rows.map((r) => r.topic)).toEqual([
        "rejected",
      ]);
    });

    it("paginates and returns an empty page past the end", async () => {
      for (let i = 0; i < 5; i += 1)
        await addIdea({ topic: `idea ${i}`, createdAt: new Date(Date.UTC(2026, 9, 1 + i)) });
      const first = await listIdeas(ctx, { pageSize: 2 });
      expect(first.rows.map((r) => r.topic)).toEqual(["idea 4", "idea 3"]);
      expect(first.total).toBe(5);
      expect((await listIdeas(ctx, { pageSize: 2, page: 3 })).rows.map((r) => r.topic)).toEqual([
        "idea 0",
      ]);
      expect((await listIdeas(ctx, { pageSize: 2, page: 9 })).rows).toEqual([]);
    });
  });

  describe("getIdeaDetail", () => {
    it("returns the linked snapshots with source and current status, the product and the variants", async () => {
      const [a, b] = [await addCard(), await addCard()] as [string, string];
      const [product] = await t.db
        .insert(schema.products)
        .values({ brandId, code: "G", name: "Grain guide", type: "GUIDE", originalLanguage: "ru" })
        .returning();
      const id = await addIdea({ productId: product?.id ?? null, commercialIntent: "NURTURE" }, [
        { id: a },
        { id: b, role: "SUPPORTING", version: 2 },
      ]);
      await t.db
        .update(schema.knowledgeItems)
        .set({ reviewStatus: "NEEDS_REVIEW", title: "Изменённый" })
        .where(eq(schema.knowledgeItems.id, b));
      const [market] = await t.db
        .select()
        .from(schema.markets)
        .where(eq(schema.markets.code, "es-ES"));
      await t.db
        .insert(schema.contentVariants)
        .values({ masterIdeaId: id, marketId: market?.id ?? "", status: "DRAFT" });

      const detail = await getIdeaDetail(ctx, id);
      expect(detail.idea.id).toBe(id);
      expect(detail.product).toEqual({ id: product?.id, code: "G", name: "Grain guide" });
      expect(
        detail.cards.map((c) => [
          c.id,
          c.role,
          c.version,
          c.currentStatus,
          c.sourceTitle,
          c.page,
          c.quote,
        ]),
      ).toEqual([
        [a, "PRIMARY", 2, "CHEF_APPROVED", "Guide to grains", 7, "точная цитата"],
        [b, "SUPPORTING", 2, "NEEDS_REVIEW", "Guide to grains", 7, "точная цитата"],
      ]);
      expect(detail.cards[1]?.title).toMatch(/^Версия /);
      expect(detail.variants).toEqual([
        { id: expect.any(String), marketCode: "es-ES", status: "DRAFT" },
      ]);
      expect(detail.canEdit).toBe(true);
    });

    it("cannot be edited once a variant is past DRAFT or the idea is rejected", async () => {
      const card = await addCard();
      const id = await addIdea({}, [{ id: card }]);
      const [market] = await t.db.select().from(schema.markets);
      await t.db
        .insert(schema.contentVariants)
        .values({ masterIdeaId: id, marketId: market?.id ?? "", status: "READY_FOR_REVIEW" });
      expect((await getIdeaDetail(ctx, id)).canEdit).toBe(false);
      const rejected = await addIdea({ status: "REJECTED" }, [{ id: card }]);
      expect((await getIdeaDetail(ctx, rejected)).canEdit).toBe(false);
    });

    it("works for an idea without cards and fails for an unknown one", async () => {
      const id = await addIdea();
      expect(await getIdeaDetail(ctx, id)).toMatchObject({
        cards: [],
        variants: [],
        product: null,
        canEdit: true,
      });
      await expect(
        getIdeaDetail(ctx, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("searchCardsForIdea", () => {
    it("returns approved cards only, newest first, with the version a link would store", async () => {
      const old = await addCard({ approvedVersion: 3 });
      const fresh = await addCard({ approvedVersion: 5 });
      await addCard({ reviewStatus: "NEEDS_REVIEW" });
      await addCard({ reviewStatus: "ARCHIVED" });
      const choices = await searchCardsForIdea(ctx);
      expect(choices.map((c) => [c.id, c.version])).toEqual([
        [fresh, 5],
        [old, 3],
      ]);
      expect(choices[0]).toMatchObject({ category: "GRAINS_RICE_PASTA", language: "ru" });
    });

    it("filters by a text search and cuts long claims", async () => {
      await addCard({ title: "Рис", claim: "Промывка риса" });
      const long = await addCard({ title: "Яйца", claim: `${"длинное ".repeat(60)}конец` });
      expect((await searchCardsForIdea(ctx, { q: "промывка" })).map((c) => c.title)).toEqual([
        "Рис",
      ]);
      const [card] = await searchCardsForIdea(ctx, { q: "яйца" });
      expect(card?.id).toBe(long);
      expect(card?.claim.length).toBeLessThanOrEqual(200);
      expect(await searchCardsForIdea(ctx, { q: "нет такого" })).toEqual([]);
    });

    it("returns at most 15", async () => {
      for (let i = 0; i < 17; i += 1) await addCard();
      expect(await searchCardsForIdea(ctx)).toHaveLength(15);
    });
  });

  describe("listActiveProducts", () => {
    it("lists active products by name", async () => {
      const add = (code: string, name: string, status: "ACTIVE" | "INACTIVE") =>
        t.db
          .insert(schema.products)
          .values({ brandId, code, name, type: "GUIDE", originalLanguage: "ru", status });
      await add("B", "Beta", "ACTIVE");
      await add("A", "Alpha", "ACTIVE");
      await add("OLD", "Old", "INACTIVE");
      expect((await listActiveProducts(ctx)).map((p) => p.code)).toEqual(["A", "B"]);
    });
  });
});
