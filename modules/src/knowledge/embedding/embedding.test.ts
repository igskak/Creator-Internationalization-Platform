import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { TransientError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import {
  createFakeEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
  embeddingHash,
} from "@rc/lib/providers/embeddings";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { cardEmbeddingText } from "./card-text";
import { DUPLICATE_SIMILARITY, suggestDuplicates } from "./dedupe";
import { embedKnowledgeItems, findStaleKnowledgeItemIds } from "./embed";
import { embedAndSuggest } from "./job";

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

/** A unit vector with cosine `c` to the first axis. */
const withCosine = (c: number, axis = 1) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i === 0 ? c : i === axis ? Math.sqrt(1 - c * c) : 0,
  );

describe("cardEmbeddingText", () => {
  const card = {
    title: " Гречка ",
    claim: "Крышку не поднимают.",
    explanation: "",
    procedureJson: [{ n: 1, text: "Варить 15 минут." }],
    commonMistakesJson: [{ mistake: "Мешать", why: "Зёрна разбиваются" }],
  };

  it("joins title, claim, explanation, steps and mistakes, skipping empty parts", () => {
    expect(cardEmbeddingText(card)).toBe(
      "Гречка\nКрышку не поднимают.\nВарить 15 минут.\nМешать\nЗёрна разбиваются",
    );
  });

  it("changes when any of these fields changes", () => {
    const base = embeddingHash(cardEmbeddingText(card));
    expect(embeddingHash(cardEmbeddingText({ ...card, claim: "Другое." }))).not.toBe(base);
    expect(embeddingHash(cardEmbeddingText({ ...card, procedureJson: [] }))).not.toBe(base);
  });
});

describe("card embeddings and duplicate suggestions", () => {
  let t: TestDb;
  let brandId: string;
  let sourceId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({ brandId, type: "GUIDE", title: "g", originalLanguage: "ru", rights })
      .returning();
    sourceId = source?.id ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  const ctxWith = (embeddings: ReturnType<typeof createFakeEmbeddingProvider>): ServiceContext =>
    createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" }, embeddings });
  const addCard = async (
    claim: string,
    over: Partial<typeof schema.knowledgeItems.$inferInsert> = {},
  ) => {
    const [row] = await t.db
      .insert(schema.knowledgeItems)
      .values({
        brandId,
        title: claim.slice(0, 20),
        category: "TECHNIQUES",
        claim,
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "NEEDS_REVIEW",
        sourceAssetId: sourceId,
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
    if (!row) throw new Error("missing card");
    return row;
  };

  describe("embedKnowledgeItems", () => {
    it("stores the vector, model and text hash, then skips cards that are current", async () => {
      const fake = createFakeEmbeddingProvider({ model: "fake-1" });
      const ctx = ctxWith(fake);
      const a = await addCard("Гречку заливают водой 1:2");
      const b = await addCard("Рис остужают тонким слоем");

      const first = await embedKnowledgeItems(ctx, [a, b]);
      expect([...first.embedded].sort()).toEqual([a, b].sort());
      expect(first.skipped).toEqual([]);
      const row = await card(a);
      expect(row.embedding).toHaveLength(1536);
      expect(row.embeddingModel).toBe("fake-1");
      expect(row.embeddingHash).toBe(embeddingHash(cardEmbeddingText(row)));
      expect(fake.calls).toHaveLength(1);

      const second = await embedKnowledgeItems(ctx, [a, b]);
      expect(second.embedded).toEqual([]);
      expect([...second.skipped].sort()).toEqual([a, b].sort());
      expect(fake.calls).toHaveLength(1); // nothing was embedded again
    });

    it("re-embeds a card whose text was edited, and only that card", async () => {
      const fake = createFakeEmbeddingProvider();
      const ctx = ctxWith(fake);
      const a = await addCard("Первое утверждение");
      const b = await addCard("Второе утверждение");
      await embedKnowledgeItems(ctx, [a, b]);
      const before = (await card(a)).embeddingHash;

      await t.db
        .update(schema.knowledgeItems)
        .set({ claim: "Первое, но исправленное" })
        .where(eq(schema.knowledgeItems.id, a));
      const result = await embedKnowledgeItems(ctx, [a, b]);
      expect(result).toEqual({ embedded: [a], skipped: [b] });
      expect((await card(a)).embeddingHash).not.toBe(before);
      expect(fake.calls.at(-1)?.texts).toHaveLength(1);
    });

    it("re-embeds everything when the model changes", async () => {
      const a = await addCard("Утверждение");
      await embedKnowledgeItems(ctxWith(createFakeEmbeddingProvider({ model: "m1" })), [a]);
      const result = await embedKnowledgeItems(
        ctxWith(createFakeEmbeddingProvider({ model: "m2" })),
        [a],
      );
      expect(result.embedded).toEqual([a]);
      expect((await card(a)).embeddingModel).toBe("m2");
    });

    it("leaves archived and unknown cards alone and handles an empty list", async () => {
      const fake = createFakeEmbeddingProvider();
      const ctx = ctxWith(fake);
      const archived = await addCard("В архиве", { reviewStatus: "ARCHIVED" });
      expect(
        await embedKnowledgeItems(ctx, [archived, "11111111-1111-4111-8111-111111111111"]),
      ).toEqual({ embedded: [], skipped: [] });
      expect(await embedKnowledgeItems(ctx, [])).toEqual({ embedded: [], skipped: [] });
      expect(fake.calls).toHaveLength(0);
      expect((await card(archived)).embedding).toBeNull();
    });

    it("lets a provider error through so the job runner can retry", async () => {
      const failing = createFakeEmbeddingProvider();
      failing.embed = async () => {
        throw new TransientError("rate limited");
      };
      const a = await addCard("Утверждение");
      await expect(embedKnowledgeItems(ctxWith(failing), [a])).rejects.toBeInstanceOf(
        TransientError,
      );
      expect((await card(a)).embedding).toBeNull();
    });

    it("finds cards without a vector or with one from another model", async () => {
      const ctx = ctxWith(createFakeEmbeddingProvider({ model: "m1" }));
      const fresh = await addCard("Свежая");
      const old = await addCard("Старая");
      const missing = await addCard("Без вектора");
      await addCard("В архиве", { reviewStatus: "ARCHIVED" });
      await embedKnowledgeItems(ctxWith(createFakeEmbeddingProvider({ model: "m0" })), [old]);
      await embedKnowledgeItems(ctx, [fresh]);
      expect((await findStaleKnowledgeItemIds(ctx)).sort()).toEqual([old, missing].sort());
    });
  });

  describe("suggestDuplicates", () => {
    const TEXTS = ["Гречку не мешают во время варки", "Во время варки гречку мешать нельзя"];

    it("flags the newer card of a forced similar pair and points at the older one", async () => {
      const fake = createFakeEmbeddingProvider({
        similar: [
          TEXTS.map((claim) =>
            cardEmbeddingText({
              title: claim.slice(0, 20),
              claim,
              explanation: "",
              procedureJson: [],
              commonMistakesJson: [],
            }),
          ),
        ],
      });
      const ctx = ctxWith(fake);
      const older = await addCard(TEXTS[0] ?? "", { createdAt: new Date("2026-10-01T10:00:00Z") });
      const newer = await addCard(TEXTS[1] ?? "", { createdAt: new Date("2026-10-02T10:00:00Z") });
      const other = await addCard("Рис остужают тонким слоем");
      await embedKnowledgeItems(ctx, [older, newer, other]);

      const found = await suggestDuplicates(ctx, [older, newer, other]);
      expect(found).toEqual([expect.objectContaining({ id: newer, duplicateOfId: older })]);
      expect(found[0]?.similarity).toBeGreaterThan(0.99);
      expect(await card(newer)).toMatchObject({
        duplicateOfId: older,
        reviewFlags: ["DUPLICATE_SUSPECTED"],
      });
      expect(await card(older)).toMatchObject({ duplicateOfId: null, reviewFlags: [] });
      expect(await card(other)).toMatchObject({ duplicateOfId: null, reviewFlags: [] });
    });

    it("flags exactly one of two cards created at the same moment", async () => {
      const ctx = ctxWith(createFakeEmbeddingProvider());
      const same = new Date("2026-10-03T10:00:00Z");
      const a = await addCard("Одинаковый текст", { createdAt: same });
      const b = await addCard("Одинаковый текст", { createdAt: same });
      await embedKnowledgeItems(ctx, [a, b]);
      const found = await suggestDuplicates(ctx, [a, b]);
      expect(found).toHaveLength(1);
      expect(found[0]?.similarity).toBeCloseTo(1, 4);
      expect([a, b]).toContain(found[0]?.id);
      expect(found[0]?.duplicateOfId).not.toBe(found[0]?.id);
    });

    it(`uses the ${DUPLICATE_SIMILARITY} cosine threshold`, async () => {
      const ctx = ctxWith(createFakeEmbeddingProvider());
      const base = await addCard("Базовая", {
        createdAt: new Date("2026-10-01T10:00:00Z"),
        embedding: withCosine(1),
      });
      const close = await addCard("Похожая", {
        createdAt: new Date("2026-10-02T10:00:00Z"),
        embedding: withCosine(0.93),
      });
      const far = await addCard("Не очень", {
        createdAt: new Date("2026-10-02T10:00:00Z"),
        embedding: withCosine(0.91, 2),
      });
      const found = await suggestDuplicates(ctx, [base, close, far]);
      expect(found.map((f) => f.id)).toEqual([close]);
      expect(found[0]?.similarity).toBeCloseTo(0.93, 3);
      expect((await card(far)).reviewFlags).toEqual([]);
    });

    it("compares only cards of the same language and ignores archived ones", async () => {
      const ctx = ctxWith(createFakeEmbeddingProvider());
      const vector = withCosine(1);
      await addCard("Spanish twin", {
        language: "es",
        embedding: vector,
        createdAt: new Date("2026-10-01T10:00:00Z"),
      });
      await addCard("Archived twin", {
        reviewStatus: "ARCHIVED",
        embedding: vector,
        createdAt: new Date("2026-10-01T10:00:00Z"),
      });
      const ru = await addCard("Русская", {
        embedding: vector,
        createdAt: new Date("2026-10-02T10:00:00Z"),
      });
      expect(await suggestDuplicates(ctx, [ru])).toEqual([]);
    });

    it("keeps existing flags, ignores cards without a vector, and clears a match that is gone", async () => {
      const ctx = ctxWith(createFakeEmbeddingProvider());
      const old = await addCard("Старая", {
        embedding: withCosine(1),
        createdAt: new Date("2026-10-01T10:00:00Z"),
      });
      const dup = await addCard("Дубль", {
        embedding: withCosine(0.99),
        createdAt: new Date("2026-10-02T10:00:00Z"),
        reviewFlags: ["SAFETY_SENSITIVE"],
      });
      const bare = await addCard("Без вектора");
      await suggestDuplicates(ctx, [dup, bare]);
      expect((await card(dup)).reviewFlags).toEqual(["SAFETY_SENSITIVE", "DUPLICATE_SUSPECTED"]);
      expect((await card(bare)).reviewFlags).toEqual([]);

      // Running again does not duplicate the flag.
      await suggestDuplicates(ctx, [dup]);
      expect((await card(dup)).reviewFlags).toEqual(["SAFETY_SENSITIVE", "DUPLICATE_SUSPECTED"]);

      // The text moved away: the suggestion is withdrawn, the other flag stays.
      await t.db
        .update(schema.knowledgeItems)
        .set({ embedding: withCosine(0, 5) })
        .where(eq(schema.knowledgeItems.id, dup));
      expect(await suggestDuplicates(ctx, [dup])).toEqual([]);
      expect(await card(dup)).toMatchObject({
        duplicateOfId: null,
        reviewFlags: ["SAFETY_SENSITIVE"],
      });
      expect((await card(old)).reviewFlags).toEqual([]);
    });
  });

  describe("embedAndSuggest (job J3)", () => {
    it("embeds the given cards and suggests duplicates for the ones it embedded", async () => {
      const ctx = ctxWith(createFakeEmbeddingProvider());
      const a = await addCard("Тот же текст", { createdAt: new Date("2026-10-01T10:00:00Z") });
      const b = await addCard("Тот же текст", { createdAt: new Date("2026-10-02T10:00:00Z") });
      const c = await addCard("Совсем другое");
      const result = await embedAndSuggest(ctx, { knowledgeItemIds: [a, b, c] });
      expect(result).toMatchObject({ embedded: 3, skipped: 0 });
      expect(result.duplicates).toEqual([expect.objectContaining({ id: b, duplicateOfId: a })]);

      const again = await embedAndSuggest(ctx, { knowledgeItemIds: [a, b, c] });
      expect(again).toEqual({ embedded: 0, skipped: 3, duplicates: [] });
      expect((await card(b)).reviewFlags).toEqual(["DUPLICATE_SUSPECTED"]); // not undone by the repeat
    });

    it("without ids backfills every stale card", async () => {
      const ctx = ctxWith(createFakeEmbeddingProvider());
      const a = await addCard("Первая");
      const b = await addCard("Вторая");
      await embedKnowledgeItems(ctx, [a]);
      const result = await embedAndSuggest(ctx, {});
      expect(result).toMatchObject({ embedded: 1, skipped: 0 });
      expect((await card(b)).embedding).toHaveLength(1536);
    });
  });
});
