import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type JobRunner, type ServiceContext } from "../../core";
import { createManualKnowledgeCard } from "./create";
import { mergeDuplicateCards } from "./merge";

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

describe("manual cards and merging duplicates", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let brandId: string;
  let sourceId: string;
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
      actor: { type: "USER", userId: user?.id ?? "", role: "editor" },
    });
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
        processingAttempt: 1,
      })
      .returning();
    sourceId = source?.id ?? "";
    await t.db.insert(schema.sourcePages).values({
      sourceAssetId: sourceId,
      pageNumber: 2,
      text: "Гречку варят 15 минут при слабом огне. Остывший рис хранят при 4 градусах.",
      charCount: 70,
      processingAttempt: 1,
    });
  });
  afterEach(async () => {
    await t.close();
  });

  const setRole = (role: "editor" | "chef") => {
    if (ctx.actor.type === "USER") {
      ctx = createServiceContext({
        db: t.db,
        logger,
        jobs: ctx.jobs,
        actor: { type: "USER", userId: ctx.actor.userId, role },
      });
    }
  };
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

  describe("createManualKnowledgeCard", () => {
    it("creates a card in review, written by hand, and asks for its embedding", async () => {
      const created = await createManualKnowledgeCard(ctx, {
        title: "  Рис для плова  ",
        category: "GRAINS_RICE_PASTA",
        claim: "Рис промывают до прозрачной воды.",
        procedure: [{ n: 9, text: "Промыть." }],
        tags: ["рис"],
        language: "ru",
      });
      expect(created).toMatchObject({
        title: "Рис для плова",
        origin: "MANUAL",
        status: "NEEDS_REVIEW",
        version: 1,
        language: "ru",
        sourceAssetId: null,
        sourceReference: null,
        createdBy: ctx.actor.type === "USER" ? ctx.actor.userId : null,
      });
      expect(created).not.toHaveProperty("embedding");
      expect((await card(created.id)).procedureJson).toEqual([{ n: 1, text: "Промыть." }]);
      expect(triggered).toEqual([
        { name: "embed-knowledge-items", payload: { knowledgeItemIds: [created.id] } },
      ]);
      const events = await t.db.select().from(schema.auditEvents);
      expect(events.map((e) => e.action)).toContain("knowledge.created_manual");
    });

    it("takes the language of the source and keeps the cited pages", async () => {
      const created = await createManualKnowledgeCard(ctx, {
        title: "Гречка",
        category: "GRAINS_RICE_PASTA",
        claim: "Гречку варят 15 минут.",
        source: { sourceAssetId: sourceId, pageStart: 2 },
      });
      expect(created.language).toBe("ru");
      expect(created.sourceAssetId).toBe(sourceId);
      expect(created.sourceReference).toMatchObject({
        pageStart: 2,
        pageEnd: 2,
        quoteVerified: true,
      });
    });

    it("raises the safety flag from the text unless the author decides", async () => {
      const risky = await createManualKnowledgeCard(ctx, {
        title: "Курица",
        category: "GRAINS_RICE_PASTA",
        claim: "Курицу готовят до 75 °C внутри.",
        temperatures: [{ value: 75, unit: "C", target: "CORE", context: "внутри" }],
        language: "ru",
      });
      expect(risky).toMatchObject({ safetySensitive: true, flags: ["SAFETY_SENSITIVE"] });
      const decided = await createManualKnowledgeCard(ctx, {
        title: "Курица",
        category: "GRAINS_RICE_PASTA",
        claim: "Курицу готовят до 75 °C внутри.",
        temperatures: [{ value: 75, unit: "C", target: "CORE", context: "внутри" }],
        safetySensitive: false,
        language: "ru",
      });
      expect(decided).toMatchObject({ safetySensitive: false, flags: [] });
    });

    it("refuses an unknown category, a missing language, an unknown source and wrong pages", async () => {
      const base = { title: "X", claim: "Y", category: "GRAINS_RICE_PASTA", language: "ru" };
      await expect(createManualKnowledgeCard(ctx, { ...base, category: "NOPE" })).rejects.toThrow(
        ValidationError,
      );
      await expect(
        createManualKnowledgeCard(ctx, { title: "X", claim: "Y", category: "GRAINS_RICE_PASTA" }),
      ).rejects.toThrow(ValidationError);
      await expect(
        createManualKnowledgeCard(ctx, {
          ...base,
          source: { sourceAssetId: "00000000-0000-4000-8000-000000000000" },
        }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        createManualKnowledgeCard(ctx, {
          ...base,
          source: { sourceAssetId: sourceId, pageStart: 5, pageEnd: 3 },
        }),
      ).rejects.toThrow(ValidationError);
      await expect(createManualKnowledgeCard(ctx, { ...base, claim: "" })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("mergeDuplicateCards", () => {
    it("archives the duplicates as DUPLICATE of the card that stays", async () => {
      setRole("chef");
      const keep = await addCard({ title: "Гречка", reviewStatus: "CHEF_APPROVED" });
      const a = await addCard({ title: "Гречка (копия)" });
      const b = await addCard({ title: "Гречка (ещё копия)", reviewStatus: "CHEF_APPROVED" });
      expect(await mergeDuplicateCards(ctx, { keepId: keep, duplicateIds: [a, b, a] })).toEqual({
        archived: 2,
      });
      for (const id of [a, b]) {
        expect(await card(id)).toMatchObject({
          reviewStatus: "ARCHIVED",
          archiveReason: "DUPLICATE",
          duplicateOfId: keep,
        });
      }
      expect((await card(keep)).reviewStatus).toBe("CHEF_APPROVED");
      const events = (await t.db.select().from(schema.auditEvents)).filter(
        (e) => e.action === "knowledge.merged",
      );
      expect(events).toHaveLength(2);
      expect(events.find((e) => e.entityId === b)?.data).toMatchObject({
        keepId: keep,
        wasApproved: true,
      });
    });

    it("is for the chef and the owner only", async () => {
      setRole("editor");
      const keep = await addCard();
      const dup = await addCard({ title: "Копия" });
      await expect(mergeDuplicateCards(ctx, { keepId: keep, duplicateIds: [dup] })).rejects.toThrow(
        ForbiddenError,
      );
      expect((await card(dup)).reviewStatus).toBe("NEEDS_REVIEW");
    });

    it("refuses a card merged into itself, unknown cards and archived cards, and changes nothing", async () => {
      setRole("chef");
      const keep = await addCard();
      const dup = await addCard({ title: "Копия" });
      const gone = await addCard({ title: "Архив", reviewStatus: "ARCHIVED" });
      await expect(
        mergeDuplicateCards(ctx, { keepId: keep, duplicateIds: [keep] }),
      ).rejects.toThrow(ValidationError);
      await expect(
        mergeDuplicateCards(ctx, {
          keepId: keep,
          duplicateIds: [dup, "00000000-0000-4000-8000-000000000000"],
        }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        mergeDuplicateCards(ctx, { keepId: keep, duplicateIds: [dup, gone] }),
      ).rejects.toThrow(ConflictError);
      await expect(mergeDuplicateCards(ctx, { keepId: gone, duplicateIds: [dup] })).rejects.toThrow(
        ConflictError,
      );
      expect((await card(dup)).reviewStatus).toBe("NEEDS_REVIEW");
    });
  });
});
