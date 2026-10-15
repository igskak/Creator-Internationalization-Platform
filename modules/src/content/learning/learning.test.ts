import { schema } from "@rc/db";
import type { PerformanceMemory } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPipelineContext } from "../pipeline/context";
import { writerInput } from "../pipeline/inputs";
import { type ReviewFixture, reviewFixture } from "../variants/test-support";
import { latestMemory, memoryForIdeas, writerLearning } from "./index";

// M7-04: what the performance memory gives the writer (hook guidance, an avoid list, the best posts
// at day 7) and the idea generator (compact JSON). Only the versions with the rules get it.

const memory = (over: Partial<PerformanceMemory> = {}): PerformanceMemory => ({
  marketCode: "es-ES",
  window: { from: "2026-08-16", to: "2026-10-10" },
  basis: { publications: 24, metric: "D7", minSample: 3 },
  topPatterns: [
    {
      dimension: "hook_type",
      value: "QUESTION",
      n: 7,
      metric: "save_rate",
      lift: 1.67,
      confidence: "medium",
    },
    {
      dimension: "daypart",
      value: "EVENING",
      n: 9,
      metric: "share_rate",
      lift: 1.3,
      confidence: "medium",
    },
  ],
  weakPatterns: [
    {
      dimension: "hook_type",
      value: "LIST",
      n: 4,
      metric: "share_rate",
      lift: 0.6,
      confidence: "low",
    },
  ],
  overusedThemes: [],
  coverageGaps: [],
  untestedHypotheses: [],
  offerPriorities: [],
  feedback: {
    topRejectionReasons: [
      { code: "WEAK_HOOK", count: 4 },
      { code: "TRANSLATIONESE", count: 1 },
    ],
    mostEditedFields: [],
    hookRewrites: [],
  },
  caveats: ["Only 24 posts; patterns are directional, not proof."],
  ...over,
});

describe("writerLearning and memoryForIdeas", () => {
  const labels = {
    hookType: (c: string) => ({ QUESTION: "Question", LIST: "List" })[c] ?? c,
    reason: (c: string) => ({ WEAK_HOOK: "Weak hook" })[c] ?? c,
  };

  it("turns hook-type patterns into advice and rejection reasons into an avoid list", () => {
    expect(writerLearning(memory(), labels)).toEqual({
      hookGuidance: [
        "Question hooks did better: 1.67× the market's save rate (7 posts, medium confidence).",
        "List hooks did worse: 0.6× the market's share rate (4 posts, low confidence).",
      ],
      avoid: ["Weak hook (sent back 4 times lately)", "TRANSLATIONESE (sent back 1 time lately)"],
    });
  });

  it("leaves the empty lists out of what the idea generator reads", () => {
    const text = memoryForIdeas(memory());
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      "marketCode",
      "window",
      "basis",
      "topPatterns",
      "weakPatterns",
      "caveats",
      "feedback",
    ]);
    expect(parsed.feedback).toEqual({ topRejectionReasons: memory().feedback.topRejectionReasons });
  });
});

describe("the writer's context (loadPipelineContext)", () => {
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

  async function setUp() {
    const es = fx.marketId;
    await t.db.insert(schema.performanceSummaries).values({
      marketId: es,
      windowStart: "2026-08-16",
      windowEnd: "2026-10-10",
      summaryJson: memory(),
      statsJson: { marketMedians: {}, groups: [] },
      minSample: 3,
      publicationsCount: 24,
      createdByType: "JOB",
      createdAt: fx.clock.now(),
    });
    // A published post with a D7 save rate: the best post of the market.
    const published = await fx.makeVariant({ status: "PUBLISHED" });
    await t.db
      .update(schema.contentVariants)
      .set({ hook: "El error del risotto", caption: "Guárdalo para la próxima vez." })
      .where(eq(schema.contentVariants.id, published.variantId));
    const { versionId } = await fx.makeVersion(published.variantId);
    const publicationId = await fx.makePublication(published.variantId, versionId, {
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      publishedAt: new Date("2026-09-20T09:00:00Z"),
    });
    await t.db.insert(schema.metricSnapshots).values({
      publicationId,
      snapshotSlot: "D7",
      measuredAt: new Date("2026-09-27T09:00:00Z"),
      mediaAgeHours: "168",
      reach: 1000,
      saves: 50,
      rawMetricsJson: {},
      apiVersion: "v25.0",
    });
    const draft = await fx.makeVariant({ ideaId: fx.ideaId });
    return { es, draftId: draft.variantId };
  }

  it("gives content-writer@6 the market's learning and its best post at day 7", async () => {
    const { es, draftId } = await setUp();
    const c = await loadPipelineContext(fx.ctx, fx.ideaId, [draftId], { writerVersion: 6 });
    const learning = c.learning.get(es);
    expect(learning?.hookGuidance[0]).toMatch(/hooks did better: 1\.67× the market's save rate/u);
    expect(learning?.avoid).toHaveLength(2);
    expect(c.exemplars.get(es)).toContainEqual({
      kind: "EXEMPLAR",
      text: "Hook: El error del risotto\nCaption: Guárdalo para la próxima vez.",
      note: "One of the market's best posts by save rate at day 7.",
    });
    const market = c.markets.get(es);
    const brief = { hookType: "QUESTION" } as never;
    expect(market && writerInput(c, market, brief, []).learning).toEqual(learning);
  });

  it("gives an earlier writer neither", async () => {
    const { es, draftId } = await setUp();
    const c = await loadPipelineContext(fx.ctx, fx.ideaId, [draftId], { writerVersion: 5 });
    expect(c.learning.size).toBe(0);
    expect(c.exemplars.get(es)?.some((e) => e.note?.includes("day 7"))).toBe(false);
    const market = c.markets.get(es);
    expect(
      market && "learning" in writerInput(c, market, { hookType: "QUESTION" } as never, []),
    ).toBe(false);
  });

  it("finds no memory for a market without a summary", async () => {
    expect(await latestMemory(fx.ctx, fx.marketId)).toBeNull();
  });
});
