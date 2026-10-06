import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { indexSourceChunks, searchSourceChunks } from "./chunks";

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
const filler = (n: number) =>
  Array.from(
    { length: 40 },
    (_, i) => `Строка ${n}-${i} про соль, воду и время приготовления.`,
  ).join(" ");

describe("source chunks", () => {
  let t: TestDb;
  let brandId: string;
  let sourceId: string;
  let fake: ReturnType<typeof createFakeEmbeddingProvider>;
  let ctx: ServiceContext;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    fake = createFakeEmbeddingProvider({ model: "fake-1" });
    ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" }, embeddings: fake });
    sourceId = await addSource("Гайд");
    await addPages(sourceId, [
      "Введение.\n" + filler(1),
      filler(2) + "\nЗолотое правило: гречку заливают водой в пропорции 1:2 и не мешают.",
      filler(3),
    ]);
  });
  afterEach(async () => {
    await t.close();
  });

  async function addSource(title: string) {
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId,
        type: "GUIDE",
        title,
        originalLanguage: "ru",
        rights,
        processingAttempt: 1,
        processingStatus: "READY",
      })
      .returning();
    return source?.id ?? "";
  }
  async function addPages(id: string, texts: string[]) {
    await t.db.insert(schema.sourcePages).values(
      texts.map((text, i) => ({
        sourceAssetId: id,
        pageNumber: i + 1,
        text,
        charCount: text.length,
        processingAttempt: 1,
      })),
    );
  }
  const chunksOf = async (id: string) =>
    await t.db.select().from(schema.sourceChunks).where(eq(schema.sourceChunks.sourceAssetId, id));

  describe("indexSourceChunks", () => {
    it("stores the chunks of the current attempt with their pages, vectors and model", async () => {
      const result = await indexSourceChunks(ctx, sourceId);
      const rows = (await chunksOf(sourceId)).sort((a, b) => a.chunkIndex - b.chunkIndex);
      expect(result.chunks).toBe(rows.length);
      expect(rows.length).toBeGreaterThan(1);
      expect(result).toMatchObject({ embedded: rows.length, reused: 0 });
      expect(rows[0]).toMatchObject({
        chunkIndex: 0,
        pageStart: 1,
        language: "ru",
        embeddingModel: "fake-1",
        processingAttempt: 1,
      });
      expect(rows[0]?.embedding).toHaveLength(1536);
      expect(rows.at(-1)?.pageEnd).toBe(3);
    });

    it("costs nothing the second time and replaces chunks when the text changes", async () => {
      await indexSourceChunks(ctx, sourceId);
      const calls = fake.calls.length;
      const again = await indexSourceChunks(ctx, sourceId);
      expect(again.embedded).toBe(0);
      expect(fake.calls).toHaveLength(calls);

      await t.db
        .update(schema.sourcePages)
        .set({ text: "Совсем другой текст про рис." })
        .where(eq(schema.sourcePages.pageNumber, 3));
      const changed = await indexSourceChunks(ctx, sourceId);
      expect(changed.embedded).toBeGreaterThan(0);
      expect(changed.reused).toBeGreaterThan(0);
      const texts = (await chunksOf(sourceId)).map((c) => c.text).join("\n");
      expect(texts).toContain("Совсем другой текст про рис.");
      expect(texts).not.toContain("Строка 3-0");
    });

    it("embeds everything again when the model changes", async () => {
      await indexSourceChunks(ctx, sourceId);
      const other = createServiceContext({
        db: t.db,
        logger,
        actor: { type: "SYSTEM" },
        embeddings: createFakeEmbeddingProvider({ model: "fake-2" }),
      });
      const result = await indexSourceChunks(other, sourceId);
      expect(result).toMatchObject({ reused: 0 });
      expect((await chunksOf(sourceId)).every((c) => c.embeddingModel === "fake-2")).toBe(true);
    });

    it("ignores pages of an older attempt and refuses an unknown source", async () => {
      await t.db.insert(schema.sourcePages).values({
        sourceAssetId: sourceId,
        pageNumber: 9,
        text: "Страница старой попытки.",
        charCount: 24,
        processingAttempt: 0,
      });
      await indexSourceChunks(ctx, sourceId);
      expect((await chunksOf(sourceId)).map((c) => c.text).join("")).not.toContain("старой");
      await expect(indexSourceChunks(ctx, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("searchSourceChunks", () => {
    it("finds the passage that says what was asked, with its page", async () => {
      await indexSourceChunks(ctx, sourceId);
      // The fake provider is deterministic per text, so the exact chunk text is its own best match.
      const target = (await chunksOf(sourceId)).find((c) => c.text.includes("Золотое правило"));
      expect(target).toBeDefined();
      const hits = await searchSourceChunks(ctx, { query: target?.text ?? "" });
      expect(hits[0]).toMatchObject({
        chunkId: target?.id,
        sourceTitle: "Гайд",
        pageStart: target?.pageStart,
      });
      expect(hits[0]?.similarity).toBeGreaterThan(0.99);
      expect(hits[0]?.text).toContain("гречку заливают водой в пропорции 1:2");
    });

    it("can be limited to one source and leaves archived sources out", async () => {
      const otherId = await addSource("Другой гайд");
      await addPages(otherId, [filler(7)]);
      await indexSourceChunks(ctx, sourceId);
      await indexSourceChunks(ctx, otherId);
      const query = "Строка 7-0 про соль, воду и время приготовления.";
      const all = await searchSourceChunks(ctx, { query, limit: 30 });
      expect(new Set(all.map((h) => h.sourceAssetId))).toEqual(new Set([sourceId, otherId]));
      const only = await searchSourceChunks(ctx, { query, sourceAssetId: sourceId, limit: 30 });
      expect(new Set(only.map((h) => h.sourceAssetId))).toEqual(new Set([sourceId]));
      await t.db
        .update(schema.sourceAssets)
        .set({ archivedAt: new Date() })
        .where(eq(schema.sourceAssets.id, otherId));
      const left = await searchSourceChunks(ctx, { query, limit: 30 });
      expect(left.every((h) => h.sourceAssetId === sourceId)).toBe(true);
    });

    it("skips chunks without a vector, limits the result and refuses an empty question", async () => {
      await indexSourceChunks(ctx, sourceId);
      await t.db.update(schema.sourceChunks).set({ embedding: null, embeddingModel: null });
      expect(await searchSourceChunks(ctx, { query: "гречка" })).toEqual([]);
      await indexSourceChunks(ctx, sourceId);
      expect(await searchSourceChunks(ctx, { query: "гречка", limit: 1 })).toHaveLength(1);
      await expect(searchSourceChunks(ctx, { query: "  " })).rejects.toThrow(ValidationError);
    });
  });
});
