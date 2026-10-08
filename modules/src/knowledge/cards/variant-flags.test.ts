import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type JobRunner, type ServiceContext } from "../../core";
import { getCardWithEvidence } from "./detail";
import { transitionKnowledgeCard } from "./transition";
import { updateKnowledgeCard } from "./update";
import { ideasUsingCards } from "./usage";

// Variants that cite a card the chef changes or archives (05 §5.4, M2-13a), and the "used by ideas"
// lookup. Synthetic content only.

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
const STATUSES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "FAILED",
  "PUBLISHING",
  "PUBLISHED",
  "REJECTED",
] as const;

describe("flags on variants that cite a changed card", () => {
  let t: TestDb;
  let chef: ServiceContext;
  let brandId: string;
  let cardA: string;
  let cardB: string;
  let ideaId: string;
  let marketId: string;
  const variants: Record<string, string> = {};

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const jobs: JobRunner = {
      trigger: async () => ({ runId: "r" }),
      triggerAndWaitAll: async () => [],
    };
    const [user] = await t.db.select().from(schema.appUsers);
    chef = createServiceContext({
      db: t.db,
      logger,
      jobs,
      actor: { type: "USER", userId: user?.id ?? "", role: "chef" },
    });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const [market] = await t.db.select().from(schema.markets);
    marketId = market?.id ?? "";
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({ brandId, type: "GUIDE", title: "g", originalLanguage: "ru", rights })
      .returning();
    const make = async (title: string) => {
      const [row] = await t.db
        .insert(schema.knowledgeItems)
        .values({
          brandId,
          title,
          category: "GRAINS_RICE_PASTA",
          claim: `${title}: утверждение`,
          language: "ru",
          origin: "MANUAL",
          reviewStatus: "NEEDS_REVIEW",
          sourceAssetId: source?.id ?? null,
        })
        .returning();
      const id = row?.id ?? "";
      await transitionKnowledgeCard(chef, { id, to: "CHEF_APPROVED" });
      return id;
    };
    cardA = await make("Карточка A");
    cardB = await make("Карточка B");
    const [idea] = await t.db
      .insert(schema.masterIdeas)
      .values({
        brandId,
        topic: "Rice",
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "x",
        status: "ACCEPTED",
        origin: "MANUAL",
      })
      .returning();
    ideaId = idea?.id ?? "";
    await t.db.insert(schema.masterIdeaKnowledge).values([
      { masterIdeaId: ideaId, knowledgeItemId: cardA, knowledgeVersion: 1, role: "PRIMARY" },
      { masterIdeaId: ideaId, knowledgeItemId: cardB, knowledgeVersion: 1, role: "SUPPORTING" },
    ]);
    // One variant per status: they cannot share a market, so each gets its own idea of the same cards.
    for (const status of STATUSES) {
      const [other] = await t.db
        .insert(schema.masterIdeas)
        .values({
          brandId,
          topic: `Idea ${status}`,
          category: "GRAINS_RICE_PASTA",
          angle: "COMMON_MISTAKE",
          coreMessage: "x",
          status: "ACCEPTED",
          origin: "MANUAL",
        })
        .returning();
      const [row] = await t.db
        .insert(schema.contentVariants)
        .values({
          masterIdeaId: other?.id ?? "",
          marketId,
          status,
          slidesJson: [
            {
              id: "s1",
              index: 0,
              role: "FACT",
              templateId: "B",
              slots: { body: "x" },
              images: {},
              knowledgeIds: [cardA],
              factual: true,
            },
          ],
        })
        .returning();
      variants[status] = row?.id ?? "";
    }
  });
  afterEach(async () => {
    await t.close();
  });

  const flagsOf = async (status: string) =>
    (
      await t.db
        .select()
        .from(schema.contentVariants)
        .where(eq(schema.contentVariants.id, variants[status] as string))
    )[0]?.flags;
  const edit = async (id: string) => {
    const [card] = await t.db
      .select()
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.id, id));
    return updateKnowledgeCard(chef, {
      id,
      version: card?.version ?? 1,
      patch: { claim: "Новое утверждение." },
    });
  };

  it("flags KNOWLEDGE_CHANGED on unpublished variants only when an approved card is edited", async () => {
    await edit(cardA);
    for (const status of ["DRAFT", "READY_FOR_REVIEW", "APPROVED", "SCHEDULED", "FAILED"]) {
      expect(await flagsOf(status)).toEqual(["KNOWLEDGE_CHANGED"]);
    }
    for (const status of ["PUBLISHING", "PUBLISHED", "REJECTED"])
      expect(await flagsOf(status)).toEqual([]);
    const audits = (await t.db.select().from(schema.auditEvents)).filter(
      (a) => a.action === "variant.flagged",
    );
    expect(audits).toHaveLength(5);
    expect(audits[0]?.data).toMatchObject({ flag: "KNOWLEDGE_CHANGED", cardIds: [cardA] });
  });

  it("does not flag for an edit of a card that was not approved, or for a card the variant does not cite", async () => {
    await edit(cardB); // approved, but no variant cites B
    expect(await flagsOf("DRAFT")).toEqual([]);
    await t.db
      .update(schema.knowledgeItems)
      .set({ reviewStatus: "NEEDS_REVIEW" })
      .where(eq(schema.knowledgeItems.id, cardA));
    await edit(cardA); // not approved at the time of the edit
    expect(await flagsOf("DRAFT")).toEqual([]);
  });

  it("does not add the flag twice and clears it when the card is approved again", async () => {
    await edit(cardA);
    await edit(cardA);
    expect(await flagsOf("READY_FOR_REVIEW")).toEqual(["KNOWLEDGE_CHANGED"]);
    await transitionKnowledgeCard(chef, { id: cardA, to: "CHEF_APPROVED" });
    for (const status of ["DRAFT", "READY_FOR_REVIEW", "APPROVED"])
      expect(await flagsOf(status)).toEqual([]);
    expect(
      (await t.db.select().from(schema.auditEvents)).some(
        (a) => a.action === "variant.flag_cleared",
      ),
    ).toBe(true);
  });

  it("keeps the flag while another card the variant cites is still being reviewed", async () => {
    await t.db
      .update(schema.contentVariants)
      .set({
        slidesJson: [
          {
            id: "s1",
            index: 0,
            role: "FACT",
            templateId: "B",
            slots: { body: "x" },
            images: {},
            knowledgeIds: [cardA, cardB],
            factual: true,
          },
        ],
      })
      .where(eq(schema.contentVariants.id, variants.DRAFT as string));
    await edit(cardA);
    await edit(cardB);
    await transitionKnowledgeCard(chef, { id: cardA, to: "CHEF_APPROVED" });
    expect(await flagsOf("DRAFT")).toEqual(["KNOWLEDGE_CHANGED"]);
    await transitionKnowledgeCard(chef, { id: cardB, to: "CHEF_APPROVED" });
    expect(await flagsOf("DRAFT")).toEqual([]);
  });

  it("flags KNOWLEDGE_ARCHIVED when a cited card is archived, and clears it after restore and approval", async () => {
    await transitionKnowledgeCard(chef, { id: cardA, to: "ARCHIVED", archiveReason: "INACCURATE" });
    expect(await flagsOf("DRAFT")).toEqual(["KNOWLEDGE_ARCHIVED"]);
    expect(await flagsOf("PUBLISHED")).toEqual([]);
    await transitionKnowledgeCard(chef, { id: cardA, to: "NEEDS_REVIEW" });
    expect(await flagsOf("DRAFT")).toEqual(["KNOWLEDGE_ARCHIVED"]); // still not approved
    await transitionKnowledgeCard(chef, { id: cardA, to: "CHEF_APPROVED" });
    expect(await flagsOf("DRAFT")).toEqual([]);
  });

  it("keeps both flags apart: an archived card does not clear a changed one", async () => {
    await edit(cardA);
    await transitionKnowledgeCard(chef, { id: cardA, to: "ARCHIVED", archiveReason: "SUPERSEDED" });
    expect((await flagsOf("DRAFT"))?.sort()).toEqual(["KNOWLEDGE_ARCHIVED", "KNOWLEDGE_CHANGED"]);
    await transitionKnowledgeCard(chef, { id: cardA, to: "NEEDS_REVIEW" });
    await transitionKnowledgeCard(chef, { id: cardA, to: "CHEF_APPROVED" });
    expect(await flagsOf("DRAFT")).toEqual([]);
  });

  describe("ideasUsingCards and the card screen", () => {
    it("lists the live ideas of a card, by card, and leaves out archived ideas", async () => {
      const used = await ideasUsingCards(chef, [cardA, cardB, crypto.randomUUID()]);
      expect(used.get(cardA)).toEqual([{ id: ideaId, topic: "Rice" }]);
      expect(used.get(cardB)).toEqual([{ id: ideaId, topic: "Rice" }]);
      expect(used.size).toBe(2);
      await t.db
        .update(schema.masterIdeas)
        .set({ status: "ARCHIVED" })
        .where(eq(schema.masterIdeas.id, ideaId));
      expect((await ideasUsingCards(chef, [cardA])).get(cardA) ?? []).toEqual([]);
      expect((await ideasUsingCards(chef, [])).size).toBe(0);
    });

    it("fills usedByIdeas in the card detail", async () => {
      const detail = await getCardWithEvidence(chef, cardA);
      expect(detail.usedByIdeas).toEqual([{ id: ideaId, topic: "Rice" }]);
    });
  });
});
