import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import type { ideaGenerator } from "@rc/prompts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "../variants/test-support";
import { ideaRelevance, OVERUSED_RELEVANCE, overAsk, pickDiverse } from "./diversity";
import {
  categoryWeightsFrom,
  findCoverageGaps,
  findOverusedThemes,
  GAP_WEIGHT,
  OVERUSED_WEIGHT,
} from "./overuse";

// M7-05: the overuse pre-filter (on fixture history) and the MMR pick over proposed ideas.

type Idea = ideaGenerator.IdeaDraft;
const idea = (topic: string, category = "GRAINS_RICE_PASTA", angle = "COMMON_MISTAKE"): Idea => ({
  topic,
  category,
  angle,
  coreMessage: `${topic}.`,
  primaryKnowledgeIds: ["c1"],
  supportingKnowledgeIds: [],
  recommendedFormat: "CAROUSEL",
  commercialIntent: "NONE",
  productCode: null,
  rationale: "Card c1.",
  whyNow: "Gap.",
  differsFromRecent: "New.",
});

describe("pickDiverse", () => {
  const unit = (i: number) => [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];

  it("keeps everything when there are not more ideas than wanted", () => {
    const ideas = [idea("A"), idea("B")];
    expect(pickDiverse(ideas, [unit(0), unit(1)], { count: 2, overused: [] }).kept).toEqual(ideas);
  });

  it("drops the near copy and keeps the different idea, in the model's order", () => {
    const ideas = [idea("Rice A"), idea("Rice A again"), idea("Eggs")];
    // The first two are the same direction; the third is orthogonal.
    const vectors = [unit(0), unit(0), unit(1)];
    const { kept, left } = pickDiverse(ideas, vectors, { count: 2, overused: [] });
    expect(kept.map((i) => i.topic)).toEqual(["Rice A", "Eggs"]);
    expect(left.map((i) => i.topic)).toEqual(["Rice A again"]);
  });

  it("prefers an idea outside an overused theme", () => {
    const ideas = [idea("Rice", "GRAINS_RICE_PASTA"), idea("Sauce", "SAUCES"), idea("Egg", "EGGS")];
    const vectors = [unit(0), unit(1), unit(2)];
    const overused = [{ category: "GRAINS_RICE_PASTA", count: 4, windowDays: 21 }];
    expect(pickDiverse(ideas, vectors, { count: 2, overused }).kept.map((i) => i.topic)).toEqual([
      "Sauce",
      "Egg",
    ]);
    expect(ideaRelevance(ideas[0] as Idea, overused)).toBe(OVERUSED_RELEVANCE);
    // An angle entry hits only that angle of the category.
    const pair = [{ category: "GRAINS_RICE_PASTA", angle: "MYTH", count: 3, windowDays: 21 }];
    expect(ideaRelevance(ideas[0] as Idea, pair)).toBe(1);
  });

  it("asks for a third more, at least one, at most ten", () => {
    expect([1, 3, 5, 9, 10].map(overAsk)).toEqual([2, 4, 7, 10, 10]);
  });
});

describe("overuse and gaps on fixture history", () => {
  let t: TestDb;
  let fx: ReviewFixture;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reviewFixture(t.db);
  });
  afterEach(async () => {
    await t.close();
  });

  /** An approved variant of a new idea in a category and angle, approved `daysAgo`. */
  async function approved(category: string, angle: string, daysAgo: number, marketCode = "es-ES") {
    const { variantId } = await fx.makeVariant({ status: "APPROVED", marketCode });
    const [variant] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variantId));
    await t.db
      .update(schema.masterIdeas)
      .set({ category, angle })
      .where(eq(schema.masterIdeas.id, variant?.masterIdeaId ?? ""));
    const { versionId } = await fx.makeVersion(variantId);
    await t.db
      .update(schema.contentVariantVersions)
      .set({ approvedAt: new Date(fx.clock.now().getTime() - daysAgo * 86_400_000) })
      .where(eq(schema.contentVariantVersions.id, versionId));
    return variant?.masterIdeaId ?? "";
  }

  it("names a category from three approvals in three weeks, and a narrower angle pair", async () => {
    await approved("GRAINS_RICE_PASTA", "COMMON_MISTAKE", 2);
    await approved("GRAINS_RICE_PASTA", "COMMON_MISTAKE", 5);
    await approved("GRAINS_RICE_PASTA", "COMMON_MISTAKE", 9);
    await approved("GRAINS_RICE_PASTA", "MYTH", 10);
    await approved("SAUCES", "MYTH", 3);
    await approved("SAUCES", "MYTH", 40); // outside the window
    for (let i = 0; i < 4; i++) await approved("EGGS", `ANGLE_${i}`, 30); // outside too
    const themes = await findOverusedThemes(fx.ctx, { marketId: fx.marketId });
    expect(themes).toEqual([
      { category: "GRAINS_RICE_PASTA", count: 4, windowDays: 21 },
      { category: "GRAINS_RICE_PASTA", angle: "COMMON_MISTAKE", count: 3, windowDays: 21 },
    ]);
  });

  it("names a theme above 30 % of the approvals, and counts ideas once across markets", async () => {
    await approved("SAUCES", "MYTH", 1);
    await approved("SAUCES", "MYTH", 2);
    await approved("EGGS", "MYTH", 3);
    await approved("SOUPS", "MYTH", 4);
    await approved("BREAD", "MYTH", 5);
    await approved("FISH", "MYTH", 6);
    // SAUCES: 2 of 6 = 33 % > 30 %; the angle MYTH is everywhere but is not narrower than SAUCES.
    expect(await findOverusedThemes(fx.ctx, { marketId: fx.marketId })).toContainEqual({
      category: "SAUCES",
      count: 2,
      windowDays: 21,
    });
    // The same idea approved in a second market is one idea across markets.
    const ideaId = await approved("SAUCES", "MYTH", 1);
    const second = await fx.makeVariant({ status: "APPROVED", marketCode: "en", ideaId });
    await fx.makeVersion(second.variantId);
    const across = await findOverusedThemes(fx.ctx, {});
    expect(across.find((x) => x.category === "SAUCES" && !x.angle)?.count).toBe(3);
  });

  it("turns themes and gaps into card weights", async () => {
    const weights = categoryWeightsFrom(
      [
        { category: "GRAINS_RICE_PASTA", count: 4, windowDays: 21 },
        { category: "GRAINS_RICE_PASTA", angle: "MYTH", count: 3, windowDays: 21 },
      ],
      [{ category: "SAUCES", approvedCards: 6, postsLast30d: 0 }],
    );
    expect(weights).toEqual({ GRAINS_RICE_PASTA: OVERUSED_WEIGHT, SAUCES: GAP_WEIGHT });
    expect(await findCoverageGaps(fx.ctx)).toEqual([]);
  });
});
