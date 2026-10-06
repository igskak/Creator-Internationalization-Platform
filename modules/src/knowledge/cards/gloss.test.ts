import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError, RightsBlockedError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { cardEmbeddingText, embedKnowledgeItems } from "../embedding";
import { searchApproved } from "../retrieval";
import { getCardWithEvidence } from "./detail";
import { glossTextHash, requestCardGloss, validateGloss } from "./gloss";
import { snapshotOf, transitionKnowledgeCard } from "./transition";
import { updateKnowledgeCard } from "./update";

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

describe("validateGloss", () => {
  const card = { title: "Гречка", claim: "Гречку варят 15 минут при 90 °C.", explanation: "" };
  it("keeps the numbers and the structure of the original", () => {
    expect(
      validateGloss(
        {
          title: "Buckwheat",
          claim: "Buckwheat is cooked for 15 minutes at 90 °C.",
          explanation: "",
        },
        card,
      ),
    ).toEqual([]);
    expect(
      validateGloss(
        { title: "Buckwheat", claim: "Buckwheat is cooked for 20 minutes.", explanation: "" },
        card,
      ).map((i) => i.code),
    ).toEqual(["NUMBERS_CHANGED"]);
    expect(
      validateGloss({ title: " ", claim: "", explanation: "" }, card).map((i) => i.code),
    ).toContain("EMPTY_FIELD");
    expect(
      validateGloss(
        { title: "B", claim: "15 90", explanation: "" },
        { ...card, explanation: "Потому что." },
      ).map((i) => i.code),
    ).toEqual(["EMPTY_FIELD"]);
  });
});

describe("requestCardGloss", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let brandId: string;
  let sourceId: string;
  let llmCalls: number;
  let respond: (call: number) => unknown;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    llmCalls = 0;
    respond = () => ({
      title: "Buckwheat",
      claim: "Buckwheat is cooked for 15 minutes over low heat.",
      explanation: "Steam finishes the grain.",
    });
    const llm = createFakeLLMProvider({ handler: () => respond(llmCalls++) });
    const [user] = await t.db.select().from(schema.appUsers);
    ctx = createServiceContext({
      db: t.db,
      logger,
      llm,
      embeddings: createFakeEmbeddingProvider(),
      actor: { type: "USER", userId: user?.id ?? "", role: "chef" },
    });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({ brandId, type: "GUIDE", title: "Гайд", originalLanguage: "ru", rights })
      .returning();
    sourceId = source?.id ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  const addCard = async (over: Partial<typeof schema.knowledgeItems.$inferInsert> = {}) => {
    const [row] = await t.db
      .insert(schema.knowledgeItems)
      .values({
        brandId,
        title: "Гречка",
        category: "GRAINS_RICE_PASTA",
        claim: "Гречку варят 15 минут при слабом огне.",
        explanation: "Пар доваривает крупу.",
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

  it("makes the gloss, stores it with the model and the text hash, and logs the run", async () => {
    const id = await addCard();
    const { gloss, cached } = await requestCardGloss(ctx, { id });
    expect(cached).toBe(false);
    expect(gloss).toMatchObject({
      title: "Buckwheat",
      model: "claude-opus-5-5",
      textHash: glossTextHash(await card(id)),
    });
    expect((await card(id)).glossEn).toEqual(gloss);
    const runs = await t.db.select().from(schema.generationRuns);
    expect(runs.map((r) => r.stage)).toEqual(["KNOWLEDGE_GLOSS"]);
    const events = await t.db.select().from(schema.auditEvents);
    expect(events.map((e) => e.action)).toContain("knowledge.gloss_made");
  });

  it("serves the cached gloss until the card changes or a refresh is asked for", async () => {
    const id = await addCard();
    await requestCardGloss(ctx, { id });
    expect((await requestCardGloss(ctx, { id })).cached).toBe(true);
    expect(llmCalls).toBe(1);
    await requestCardGloss(ctx, { id, refresh: true });
    expect(llmCalls).toBe(2);

    await updateKnowledgeCard(ctx, { id, version: 1, patch: { claim: "Гречку варят 20 минут." } });
    respond = () => ({
      title: "Buckwheat",
      claim: "Buckwheat is cooked for 20 minutes.",
      explanation: "x",
    });
    const again = await requestCardGloss(ctx, { id });
    expect(again.cached).toBe(false);
    expect(again.gloss.claim).toContain("20 minutes");
  });

  it("repairs a translation that lost a number, and fails when it stays wrong", async () => {
    const id = await addCard();
    respond = (call) =>
      call === 0
        ? { title: "Buckwheat", claim: "Buckwheat is cooked for a while.", explanation: "x" }
        : { title: "Buckwheat", claim: "Buckwheat is cooked for 15 minutes.", explanation: "x" };
    expect((await requestCardGloss(ctx, { id })).gloss.claim).toContain("15");
    expect(llmCalls).toBe(2);

    const other = await addCard({ title: "Рис", claim: "Рис варят 12 минут.", explanation: "" });
    respond = () => ({ title: "Rice", claim: "Rice is cooked.", explanation: "" });
    await expect(requestCardGloss(ctx, { id: other })).rejects.toThrow(ValidationError);
    expect((await card(other)).glossEn).toBeNull();
  });

  it("refuses English cards, unknown cards and sources without AI rights", async () => {
    await expect(requestCardGloss(ctx, { id: await addCard({ language: "en" }) })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      requestCardGloss(ctx, { id: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow(NotFoundError);
    await t.db
      .update(schema.sourceAssets)
      .set({ rights: { ...rights, aiProcessing: "DENIED" } })
      .where(eq(schema.sourceAssets.id, sourceId));
    await expect(requestCardGloss(ctx, { id: await addCard() })).rejects.toThrow(
      RightsBlockedError,
    );
    expect(llmCalls).toBe(0);
  });

  it("translates a manual card without a source", async () => {
    const id = await addCard({ sourceAssetId: null, origin: "MANUAL" });
    expect((await requestCardGloss(ctx, { id })).cached).toBe(false);
  });

  describe("the gloss is never approved content", () => {
    it("is shown on the card screen as a reading aid and marked stale after an edit", async () => {
      const id = await addCard();
      await requestCardGloss(ctx, { id });
      expect((await getCardWithEvidence(ctx, id)).gloss).toMatchObject({
        title: "Buckwheat",
        stale: false,
      });
      await updateKnowledgeCard(ctx, {
        id,
        version: 1,
        patch: { claim: "Гречку варят 20 минут." },
      });
      expect((await getCardWithEvidence(ctx, id)).gloss?.stale).toBe(true);
      const detail = await getCardWithEvidence(ctx, await addCard({ title: "Без глоссы" }));
      expect(detail.gloss).toBeNull();
      expect(detail.card).not.toHaveProperty("glossEn");
    });

    it("stays out of the approved snapshot, the embedding text and the retrieval results", async () => {
      const id = await addCard();
      await requestCardGloss(ctx, { id });
      await transitionKnowledgeCard(ctx, { id, to: "CHEF_APPROVED" });
      await embedKnowledgeItems(ctx, [id]);
      const row = await card(id);
      const marker = "Buckwheat";
      expect(JSON.stringify(snapshotOf(row))).not.toContain(marker);
      expect(cardEmbeddingText(row)).not.toContain(marker);
      const [version] = await t.db.select().from(schema.knowledgeItemVersions);
      expect(JSON.stringify(version?.snapshot)).not.toContain(marker);
      const hits = await searchApproved(ctx, { query: "гречка" });
      expect(hits.length).toBeGreaterThan(0);
      expect(JSON.stringify(hits)).not.toContain(marker);
    });
  });
});
