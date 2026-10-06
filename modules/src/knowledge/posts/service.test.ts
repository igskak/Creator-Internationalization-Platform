import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type JobRunner, type ServiceContext } from "../../core";
import {
  createPostsImport,
  importHistoricalPosts,
  listHistoricalPosts,
  listPostImports,
  updateHistoricalPost,
} from "./service";

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

const CSV = [
  "external_id,posted_at,caption,format,likes,comments,category,hook_type,is_exemplar",
  'p1,2026-03-01 10:00,"Гречка 🥣, без каши",CAROUSEL,100,5,GRAINS_RICE_PASTA,CURIOSITY_GAP,yes',
  "p2,2026-03-02,Рис,REEL,50,,,,",
  "p3,2026-03-03,Плохой код,,,,NOT_A_CATEGORY,,",
  "p4,не дата,Плохая дата,,,,,,",
].join("\n");

describe("historical posts", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let triggered: { name: string; payload: unknown }[];

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    triggered = [];
    const jobs: JobRunner = {
      trigger: async (name, payload) => {
        triggered.push({ name, payload });
        return { runId: "r" };
      },
      triggerAndWaitAll: async () => [],
    };
    const [user] = await t.db.select().from(schema.appUsers);
    ctx = createServiceContext({
      db: t.db,
      logger,
      jobs,
      storage: createMemoryStorage(),
      actor: { type: "USER", userId: user?.id ?? "", role: "editor" },
    });
  });
  afterEach(async () => {
    await t.close();
  });

  const run = async (text = CSV, fileName = "posts.csv") => {
    const { sourceAssetId } = await createPostsImport(ctx, {
      fileName,
      text,
      accountHandle: "@RegChef_Official",
      language: "ru",
    });
    return { sourceAssetId, outcome: await importHistoricalPosts(ctx, { sourceAssetId }) };
  };
  const posts = async () =>
    await t.db.select().from(schema.historicalPosts).orderBy(schema.historicalPosts.externalId);

  describe("createPostsImport", () => {
    it("stores the file as a source, queues it and starts J16", async () => {
      const { sourceAssetId } = await createPostsImport(ctx, {
        fileName: "posts.csv",
        text: CSV,
        accountHandle: "@RegChef_Official",
      });
      const [source] = await t.db
        .select()
        .from(schema.sourceAssets)
        .where(eq(schema.sourceAssets.id, sourceAssetId));
      expect(source).toMatchObject({
        type: "INSTAGRAM_POST",
        processingStatus: "QUEUED",
        originalLanguage: "ru",
        metadataJson: expect.objectContaining({ accountHandle: "regchef_official" }),
      });
      expect(triggered).toEqual([{ name: "import-historical-posts", payload: { sourceAssetId } }]);
      expect(source?.fileKey && (await ctx.storage.head(source.fileKey))?.size).toBe(
        new TextEncoder().encode(CSV).byteLength,
      );
    });

    it("refuses other file types and a bad handle", async () => {
      await expect(
        createPostsImport(ctx, { fileName: "posts.xlsx", text: "x", accountHandle: "chef" }),
      ).rejects.toThrow(ValidationError);
      await expect(
        createPostsImport(ctx, {
          fileName: "posts.csv",
          text: "x",
          accountHandle: "not a handle!",
        }),
      ).rejects.toThrow(ValidationError);
      expect(triggered).toEqual([]);
    });
  });

  describe("importHistoricalPosts", () => {
    it("imports the good rows, reports the bad ones and marks the source READY", async () => {
      const { sourceAssetId, outcome } = await run();
      expect(outcome).toMatchObject({
        status: "READY",
        totalRows: 4,
        created: 2,
        updated: 0,
        errorCount: 2,
      });
      const rows = await posts();
      expect(rows.map((p) => p.externalId)).toEqual(["p1", "p2"]);
      expect(rows[0]).toMatchObject({
        platform: "instagram",
        accountHandle: "regchef_official",
        format: "CAROUSEL",
        caption: "Гречка 🥣, без каши",
        language: "ru",
        metrics: expect.objectContaining({ likes: 100, comments: 5 }),
        annotations: { category: "GRAINS_RICE_PASTA", hookType: "CURIOSITY_GAP" },
        annotationStatus: "HUMAN_CONFIRMED",
        isExemplar: true,
        sourceAssetId,
      });
      expect(rows[1]).toMatchObject({
        annotationStatus: "NONE",
        isExemplar: false,
        annotations: {},
      });
      const [imports] = await listPostImports(ctx);
      expect(imports).toMatchObject({ status: "READY", fileName: "posts.csv" });
      expect(imports?.report?.errors.map((e) => [e.row, e.field])).toEqual([
        [4, "category"],
        [5, "posted_at"],
      ]);
      expect(imports?.report?.errors[0]?.message).toContain("NOT_A_CATEGORY");
    });

    it("imports a JSON file the same way", async () => {
      const json = JSON.stringify([
        { external_id: "j1", posted_at: "2026-03-05T09:00:00Z", caption: "Привет", likes: 3 },
      ]);
      const { outcome } = await run(json, "posts.json");
      expect(outcome).toMatchObject({ status: "READY", created: 1 });
    });

    it("updates on a second import: new numbers, annotations only where the file has them", async () => {
      await run();
      const second = [
        "external_id,posted_at,caption,likes,saves,angle",
        "p1,2026-03-01 10:00,Гречка (новая подпись),300,40,",
        "p2,2026-03-02,Рис,60,7,MYTH_VS_FACT",
        "p9,2026-03-09,Новый,1,,",
      ].join("\n");
      const { outcome } = await run(second);
      expect(outcome).toMatchObject({ created: 1, updated: 2, errorCount: 0 });
      const [p1, p2, p9] = await posts();
      expect(p1).toMatchObject({
        caption: "Гречка (новая подпись)",
        metrics: expect.objectContaining({ likes: 300, comments: 5, saves: 40 }),
        annotations: { category: "GRAINS_RICE_PASTA", hookType: "CURIOSITY_GAP" },
        isExemplar: true,
        annotationStatus: "HUMAN_CONFIRMED",
      });
      expect(p2).toMatchObject({
        annotations: { angle: "MYTH_VS_FACT" },
        annotationStatus: "HUMAN_CONFIRMED",
      });
      expect(p9?.externalId).toBe("p9");
      expect(await posts()).toHaveLength(3);
    });

    it("fails the source with a code when the file cannot be read, and is skipped when run again", async () => {
      const { sourceAssetId, outcome } = await run("id,caption\n1,x");
      expect(outcome).toEqual({ status: "FAILED", code: "MISSING_COLUMNS" });
      const [source] = await t.db
        .select()
        .from(schema.sourceAssets)
        .where(eq(schema.sourceAssets.id, sourceAssetId));
      expect(source).toMatchObject({
        processingStatus: "FAILED",
        processingError: expect.objectContaining({ code: "MISSING_COLUMNS" }),
      });
      expect(await importHistoricalPosts(ctx, { sourceAssetId })).toEqual({
        status: "SKIPPED",
        reason: "ALREADY_DONE",
      });
      expect(await posts()).toEqual([]);
    });

    it("knows nothing about an unknown source or one that is not an import", async () => {
      await expect(
        importHistoricalPosts(ctx, { sourceAssetId: "00000000-0000-4000-8000-000000000000" }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("listHistoricalPosts", () => {
    it("lists newest first with interactions, and filters by text, exemplar and status", async () => {
      await run();
      const all = await listHistoricalPosts(ctx);
      expect(all.total).toBe(2);
      expect(all.rows.map((r) => r.externalId)).toEqual(["p2", "p1"]);
      expect(all.rows[1]?.interactions).toBe(105);
      expect(all.rows[0]?.interactions).toBe(50);
      expect(
        (await listHistoricalPosts(ctx, { q: "гречка" })).rows.map((r) => r.externalId),
      ).toEqual(["p1"]);
      expect((await listHistoricalPosts(ctx, { exemplar: true })).total).toBe(1);
      expect(
        (await listHistoricalPosts(ctx, { annotation: "NONE" })).rows.map((r) => r.externalId),
      ).toEqual(["p2"]);
      expect((await listHistoricalPosts(ctx, { q: "100%" })).total).toBe(0);
      expect(
        (await listHistoricalPosts(ctx, { page: 2, pageSize: 1 })).rows.map((r) => r.externalId),
      ).toEqual(["p1"]);
    });
  });

  describe("updateHistoricalPost", () => {
    it("saves annotations as confirmed, clears a field, and toggles the exemplar flag", async () => {
      await run();
      const [, p2] = await posts();
      const id = p2?.id ?? "";
      const saved = await updateHistoricalPost(ctx, {
        id,
        annotations: { angle: "MYTH_VS_FACT", ctaType: "SAVE", productCode: "GUIDE-1" },
        isExemplar: true,
      });
      expect(saved).toMatchObject({
        annotations: { angle: "MYTH_VS_FACT", ctaType: "SAVE", productCode: "GUIDE-1" },
        annotationStatus: "HUMAN_CONFIRMED",
        isExemplar: true,
      });
      const cleared = await updateHistoricalPost(ctx, {
        id,
        annotations: { angle: null, ctaType: null, productCode: null },
      });
      expect(cleared).toMatchObject({
        annotations: {},
        annotationStatus: "NONE",
        isExemplar: true,
      });
      const events = (await t.db.select().from(schema.auditEvents)).filter(
        (e) => e.action === "posts.updated",
      );
      expect(events).toHaveLength(2);
    });

    it("refuses unknown codes, an empty change and an unknown post", async () => {
      await run();
      const [p1] = await posts();
      await expect(
        updateHistoricalPost(ctx, { id: p1?.id ?? "", annotations: { angle: "NOPE" } }),
      ).rejects.toThrow(ValidationError);
      await expect(updateHistoricalPost(ctx, { id: p1?.id ?? "" })).rejects.toThrow(
        ValidationError,
      );
      await expect(
        updateHistoricalPost(ctx, { id: "00000000-0000-4000-8000-000000000000", isExemplar: true }),
      ).rejects.toThrow(NotFoundError);
    });

    it("does not make an exemplar of a post whose import forbids it", async () => {
      const { sourceAssetId } = await run();
      const [, p2] = await posts();
      await t.db
        .update(schema.sourceAssets)
        .set({
          rights: {
            use: "ALLOWED",
            translate: "UNKNOWN",
            adapt: "UNKNOWN",
            visuallyTransform: "UNKNOWN",
            sell: "UNKNOWN",
            aiProcessing: "UNKNOWN",
            improvePrompts: "DENIED",
          },
        })
        .where(eq(schema.sourceAssets.id, sourceAssetId));
      await expect(
        updateHistoricalPost(ctx, { id: p2?.id ?? "", isExemplar: true }),
      ).rejects.toThrow(/rights/);
      expect((await posts())[1]?.isExemplar).toBe(false);
    });
  });
});
