import { schema } from "@rc/db";
import type { KnowledgeSnapshot, RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider, EMBEDDING_DIMENSIONS } from "@rc/lib/providers/embeddings";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { cardEmbeddingText, embedKnowledgeItems } from "../embedding";
import { selectMmr } from "./mmr";
import { candidatePool, getApprovedSnapshots, searchApproved, truncateClaim } from "./service";

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

/** A unit vector along one axis, plus a small offset that makes members of a cluster differ. */
const axis = (i: number, jitter = 0, seed = 0) => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[i] = 1;
  v[100 + (seed % 50)] = jitter;
  return v;
};

describe("selectMmr", () => {
  const item = (id: string, vector: number[], relevance = 1) => ({ id, vector, relevance });

  it("takes one card from each cluster before a second from any cluster", () => {
    const candidates = [
      ...[0, 1, 2, 3].map((n) => item(`a${n}`, axis(0, 0.01, n))),
      ...[0, 1, 2, 3].map((n) => item(`b${n}`, axis(1, 0.01, n))),
      ...[0, 1, 2, 3].map((n) => item(`c${n}`, axis(2, 0.01, n))),
    ];
    const picked = selectMmr(candidates, 3);
    expect(new Set(picked.map((id) => id[0]))).toEqual(new Set(["a", "b", "c"]));
    const six = selectMmr(candidates, 6);
    expect(
      six
        .slice(0, 3)
        .map((id) => id[0])
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("starts with the most relevant card and lets relevance outweigh a little similarity", () => {
    const candidates = [
      item("low", axis(0), 0.5),
      item("high", axis(1), 1.5),
      item("mid", axis(2), 1),
    ];
    expect(selectMmr(candidates, 3)).toEqual(["high", "mid", "low"]);
  });

  it("returns fewer cards when there are fewer candidates, none for none, and is deterministic", () => {
    expect(selectMmr([], 5)).toEqual([]);
    const candidates = [item("b", axis(0)), item("a", axis(1)), item("c", axis(2))];
    expect(selectMmr(candidates, 10)).toHaveLength(3);
    expect(selectMmr(candidates, 3)).toEqual(selectMmr([...candidates].reverse(), 3));
    expect(selectMmr(candidates, 1)).toEqual(["a"]); // equal relevance: the smaller id
    expect(selectMmr(candidates, 0)).toEqual([]);
  });

  it("uses cosine, so the length of a vector does not matter", () => {
    const long = axis(0).map((x) => x * 10);
    const picked = selectMmr([item("x", axis(0)), item("y", long), item("z", axis(1))], 2);
    expect(picked).toContain("z");
  });
});

describe("truncateClaim", () => {
  it("leaves short claims and cuts long ones at a word with an ellipsis within 200 characters", () => {
    expect(truncateClaim("Короткое утверждение.")).toBe("Короткое утверждение.");
    const long = `${"слово ".repeat(60)}конец`;
    const cut = truncateClaim(long);
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.endsWith(" …")).toBe(false);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(truncateClaim("x".repeat(300))).toHaveLength(200);
  });
});

describe("retrieval over approved cards", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let brandId: string;
  let sourceId: string;
  let n = 0;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    ctx = createServiceContext({
      db: t.db,
      logger,
      actor: { type: "SYSTEM" },
      embeddings: createFakeEmbeddingProvider(),
    });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({ brandId, type: "GUIDE", title: "g", originalLanguage: "ru", rights })
      .returning();
    sourceId = source?.id ?? "";
    n = 0;
  });
  afterEach(async () => {
    await t.close();
  });

  const addCard = async (
    over: Partial<typeof schema.knowledgeItems.$inferInsert> & { vector?: number[] } = {},
  ) => {
    n += 1;
    const { vector, ...rest } = over;
    const [row] = await t.db
      .insert(schema.knowledgeItems)
      .values({
        brandId,
        title: `Карточка ${n}`,
        category: "TECHNIQUES",
        claim: `Утверждение ${n}`,
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "CHEF_APPROVED",
        approvedVersion: 1,
        approvedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, n)),
        sourceAssetId: sourceId,
        embedding: vector ?? axis(n % 100, 0.01, n),
        embeddingModel: "fake-embedding",
        ...rest,
      })
      .returning();
    return row?.id ?? "";
  };

  describe("candidatePool", () => {
    it("returns only approved cards that have a vector, as digests", async () => {
      const ok = await addCard({
        title: "Одобренная",
        category: "FOOD_SCIENCE",
        approvedVersion: 3,
      });
      await addCard({ reviewStatus: "NEEDS_REVIEW" });
      await addCard({ reviewStatus: "EXTRACTED" });
      await addCard({ reviewStatus: "ARCHIVED" });
      await t.db.insert(schema.knowledgeItems).values({
        brandId,
        title: "Без вектора",
        category: "TECHNIQUES",
        claim: "x",
        language: "ru",
        origin: "MANUAL",
        reviewStatus: "CHEF_APPROVED",
      });
      const pool = await candidatePool(ctx);
      expect(pool.cards).toEqual([
        {
          id: ok,
          category: "FOOD_SCIENCE",
          title: "Одобренная",
          claim: expect.any(String),
          language: "ru",
          version: 3,
        },
      ]);
      expect(pool).toMatchObject({ matched: 1, exclusionApplied: false });
    });

    it("cuts long claims to 200 characters in the digest", async () => {
      await addCard({ claim: `${"длинное ".repeat(60)}конец` });
      const [card] = (await candidatePool(ctx)).cards;
      expect(card?.claim.length).toBeLessThanOrEqual(200);
      expect(card?.claim.endsWith("…")).toBe(true);
    });

    it("applies category and language filters", async () => {
      const a = await addCard({ category: "FISH_SEAFOOD" });
      const b = await addCard({ category: "MEAT" });
      const es = await addCard({ category: "MEAT", language: "es" });
      expect(
        (await candidatePool(ctx, { categories: ["FISH_SEAFOOD"] })).cards.map((c) => c.id),
      ).toEqual([a]);
      expect(
        (await candidatePool(ctx, { categories: ["MEAT", "FISH_SEAFOOD"], language: "ru" })).cards
          .map((c) => c.id)
          .sort(),
      ).toEqual([a, b].sort());
      expect((await candidatePool(ctx, { language: "es" })).cards.map((c) => c.id)).toEqual([es]);
      expect((await candidatePool(ctx, { categories: ["EQUIPMENT"] })).cards).toEqual([]);
    });

    it("picks a diverse set of at most 60 cards: one per topic before a second of any topic", async () => {
      // 3 topics × 30 near-identical cards.
      const topics = ["a", "b", "c"];
      const ids: Record<string, string[]> = { a: [], b: [], c: [] };
      for (const [ti, topic] of topics.entries()) {
        for (let k = 0; k < 30; k++) {
          ids[topic]?.push(await addCard({ title: `${topic}${k}`, vector: axis(ti, 0.01, k) }));
        }
      }
      const pool = await candidatePool(ctx);
      expect(pool.cards).toHaveLength(60);
      expect(pool.matched).toBe(90);
      expect(new Set(pool.cards.slice(0, 3).map((c) => c.title[0]))).toEqual(new Set(topics));

      const small = await candidatePool(ctx, { limit: 3 });
      expect(new Set(small.cards.map((c) => c.title[0]))).toEqual(new Set(topics));
    });

    it("leaves out recently used cards while enough remain", async () => {
      const ids: string[] = [];
      for (let k = 0; k < 6; k++) ids.push(await addCard());
      const recent = ids.slice(0, 2);
      const pool = await candidatePool(ctx, { recentlyUsedIds: recent, minPool: 3 });
      expect(pool.exclusionApplied).toBe(true);
      expect(pool.cards.map((c) => c.id).sort()).toEqual(ids.slice(2).sort());
    });

    it("drops the exclusion when it would leave fewer than the minimum pool", async () => {
      const ids: string[] = [];
      for (let k = 0; k < 6; k++) ids.push(await addCard());
      const pool = await candidatePool(ctx, { recentlyUsedIds: ids.slice(0, 4), minPool: 3 });
      expect(pool.exclusionApplied).toBe(false);
      expect(pool.cards).toHaveLength(6);
      // With the default minimum of 40 a small corpus is never thinned out.
      expect((await candidatePool(ctx, { recentlyUsedIds: ids.slice(0, 1) })).cards).toHaveLength(
        6,
      );
    });

    it("boosts a coverage-gap category and penalizes an overused one", async () => {
      const common = await addCard({ category: "MEAT", vector: axis(0) });
      const gap = await addCard({ category: "FISH_SEAFOOD", vector: axis(1) });
      const overused = await addCard({ category: "EGGS", vector: axis(2) });
      const pool = await candidatePool(ctx, { categoryWeights: { FISH_SEAFOOD: 1.5, EGGS: 0.5 } });
      expect(pool.cards.map((c) => c.id)).toEqual([gap, common, overused]);
    });

    it("is repeatable and empty without cards", async () => {
      expect(await candidatePool(ctx)).toEqual({ cards: [], matched: 0, exclusionApplied: false });
      for (let k = 0; k < 5; k++) await addCard();
      expect((await candidatePool(ctx)).cards).toEqual((await candidatePool(ctx)).cards);
    });
  });

  describe("searchApproved", () => {
    const texts = {
      buckwheat: "Гречку не мешают во время варки",
      rice: "Рис остужают тонким слоем",
      fish: "Рыбу солят заранее",
    };
    const query = "как варить гречку";

    /** Cards embedded through the real path; the query is made to land next to the buckwheat card. */
    async function setup() {
      const embeddings = createFakeEmbeddingProvider({
        similar: [
          [
            cardEmbeddingText({
              title: "Гречка",
              claim: texts.buckwheat,
              explanation: "",
              procedureJson: [],
              commonMistakesJson: [],
            }),
            query,
          ],
        ],
      });
      const searchCtx = createServiceContext({
        db: t.db,
        logger,
        actor: { type: "SYSTEM" },
        embeddings,
      });
      const ids: Record<string, string> = {};
      for (const [key, claim] of Object.entries(texts)) {
        ids[key] = await addCard({
          title: key === "buckwheat" ? "Гречка" : key,
          claim,
          category: key === "fish" ? "FISH_SEAFOOD" : "GRAINS_RICE_PASTA",
          embedding: null,
        });
      }
      await embedKnowledgeItems(searchCtx, Object.values(ids));
      return { searchCtx, ids, embeddings };
    }

    it("ranks by similarity to the query and reports it", async () => {
      const { searchCtx, ids, embeddings } = await setup();
      const hits = await searchApproved(searchCtx, { query });
      expect(hits).toHaveLength(3);
      expect(hits[0]).toMatchObject({
        id: ids.buckwheat,
        title: "Гречка",
        language: "ru",
        version: 1,
      });
      expect(hits[0]?.similarity).toBeGreaterThan(0.99);
      expect(Math.abs(hits[1]?.similarity ?? 1)).toBeLessThan(0.2);
      expect(embeddings.calls.at(-1)).toEqual({ texts: [query], purpose: "query" });
    });

    it("applies filters, the limit and a similarity floor, and never returns unapproved cards", async () => {
      const { searchCtx, ids } = await setup();
      await t.db
        .update(schema.knowledgeItems)
        .set({ reviewStatus: "NEEDS_REVIEW" })
        .where(eq(schema.knowledgeItems.id, ids.rice ?? ""));
      const all = await searchApproved(searchCtx, { query });
      expect(all.map((h) => h.id)).not.toContain(ids.rice);

      expect((await searchApproved(searchCtx, { query, limit: 1 })).map((h) => h.id)).toEqual([
        ids.buckwheat,
      ]);
      expect(
        (await searchApproved(searchCtx, { query, categories: ["FISH_SEAFOOD"] })).map((h) => h.id),
      ).toEqual([ids.fish]);
      expect(await searchApproved(searchCtx, { query, language: "es" })).toEqual([]);
      expect(
        (await searchApproved(searchCtx, { query, minSimilarity: 0.9 })).map((h) => h.id),
      ).toEqual([ids.buckwheat]);
    });

    it("rejects an empty query before embedding anything", async () => {
      const { searchCtx, embeddings } = await setup();
      const before = embeddings.calls.length;
      await expect(searchApproved(searchCtx, { query: "   " })).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(embeddings.calls).toHaveLength(before);
    });
  });

  describe("getApprovedSnapshots", () => {
    const snapshot = (title: string): KnowledgeSnapshot => ({
      title,
      category: "TECHNIQUES",
      subcategory: null,
      claim: `Утверждение: ${title}`,
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

    it("returns the frozen text of the requested versions, not the card's current text", async () => {
      const id = await addCard({ title: "Текущий заголовок" });
      await t.db.insert(schema.knowledgeItemVersions).values([
        {
          knowledgeItemId: id,
          version: 1,
          snapshot: snapshot("Версия 1"),
          status: "CHEF_APPROVED",
        },
        {
          knowledgeItemId: id,
          version: 2,
          snapshot: snapshot("Версия 2"),
          status: "CHEF_APPROVED",
        },
      ]);
      const result = await getApprovedSnapshots(ctx, [
        { knowledgeItemId: id, version: 2 },
        { knowledgeItemId: id, version: 1 },
      ]);
      expect(result.map((r) => [r.id, r.version, r.title])).toEqual([
        [id, 2, "Версия 2"],
        [id, 1, "Версия 1"],
      ]);
      expect(await getApprovedSnapshots(ctx, [])).toEqual([]);
    });

    it("fails with the missing versions listed", async () => {
      const id = await addCard();
      const error = await getApprovedSnapshots(ctx, [{ knowledgeItemId: id, version: 9 }]).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).details).toEqual({
        missing: [{ knowledgeItemId: id, version: 9 }],
      });
    });
  });
});
