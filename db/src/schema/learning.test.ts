import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PerformanceMemory } from "../json/learning";
import { PerformanceMemory as PerformanceMemorySchema } from "../json/learning";
import { createTestDb, type TestDb } from "../test-db";
import { vPublicationDimensions } from "./analytics";
import { carouselRenders, contentVariants, contentVariantVersions, masterIdeas } from "./content";
import { appUsers, brands, markets } from "./core";
import { experiments, performanceSummaries } from "./learning";
import { publications } from "./publishing";

// 0012_learning (M7-01): performance summaries, experiments, the experiment columns of a variant
// and their place in v_publication_dimensions, the summary link of an idea. Synthetic data only.

const memory = (marketCode: string): PerformanceMemory => ({
  marketCode,
  window: { from: "2026-08-20", to: "2026-10-15" },
  basis: { publications: 0, metric: "D7", minSample: 3 },
  topPatterns: [],
  weakPatterns: [],
  overusedThemes: [],
  coverageGaps: [],
  untestedHypotheses: [],
  offerPriorities: [],
  feedback: { topRejectionReasons: [], mostEditedFields: [], hookRewrites: [] },
  caveats: ["No post has numbers at day 7 yet."],
});

describe("0012_learning", () => {
  let t: TestDb;
  let brandId: string;
  let marketId: string;
  let userId: string;

  beforeAll(async () => {
    t = await createTestDb();
    const [brand] = await t.db
      .insert(brands)
      .values({ slug: "learning-brand", name: "B" })
      .returning();
    brandId = brand?.id ?? "";
    const [market] = await t.db
      .insert(markets)
      .values({
        brandId,
        code: "es-ES",
        displayName: "España",
        country: "ES",
        language: "es",
        timezone: "Europe/Madrid",
        currency: "EUR",
        measurementSystem: "METRIC",
      })
      .returning();
    marketId = market?.id ?? "";
    const [user] = await t.db
      .insert(appUsers)
      .values({ email: "owner@example.test", role: "owner" })
      .returning();
    userId = user?.id ?? "";
  });
  afterAll(async () => {
    await t.close();
  });

  const experiment = (over: Partial<typeof experiments.$inferInsert> = {}) =>
    t.db
      .insert(experiments)
      .values({
        name: "Warm vs bright",
        hypothesis: "Warm photos get more saves in Spain.",
        marketId,
        dimension: "visual_style",
        variantA: "WARM",
        variantB: "BRIGHT",
        createdBy: userId,
        ...over,
      })
      .returning();

  it("stores a summary per market or across markets, and links an idea to it", async () => {
    const [perMarket] = await t.db
      .insert(performanceSummaries)
      .values({
        marketId,
        windowStart: "2026-08-20",
        windowEnd: "2026-10-15",
        summaryJson: memory("es-ES"),
        statsJson: { marketMedians: {}, groups: [] },
        minSample: 3,
        publicationsCount: 0,
        createdByType: "JOB",
      })
      .returning();
    const [all] = await t.db
      .insert(performanceSummaries)
      .values({
        marketId: null,
        windowStart: "2026-08-20",
        windowEnd: "2026-10-15",
        summaryJson: memory("ALL"),
        statsJson: { marketMedians: {}, groups: [] },
        minSample: 3,
        publicationsCount: 0,
        createdByType: "USER",
      })
      .returning();
    expect(PerformanceMemorySchema.parse(perMarket?.summaryJson)).toEqual(memory("es-ES"));
    expect(all?.marketId).toBeNull();
    const [idea] = await t.db
      .insert(masterIdeas)
      .values({
        brandId,
        topic: "Rice",
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "Synthetic",
        origin: "AI_GENERATED",
        performanceSummaryId: all?.id ?? null,
      })
      .returning();
    expect(idea?.performanceSummaryId).toBe(all?.id);
  });

  it("checks the arms, the metric and the minimum per arm, and keeps updated_at current", async () => {
    await expect(experiment({ variantB: "WARM" })).rejects.toThrow();
    await expect(experiment({ minPostsPerArm: 1 })).rejects.toThrow();
    await expect(
      experiment({ primaryMetric: "reach" as unknown as "save_rate" }),
    ).rejects.toThrow();
    const [row] = await experiment();
    expect(row).toMatchObject({ status: "DRAFT", primaryMetric: "save_rate", minPostsPerArm: 5 });
    await t.db.execute(
      sql`update experiments set updated_at = '2020-01-01' where id = ${row?.id ?? ""}`,
    );
    await t.db
      .update(experiments)
      .set({ status: "RUNNING" })
      .where(eq(experiments.id, row?.id ?? ""));
    const [after] = await t.db
      .select()
      .from(experiments)
      .where(eq(experiments.id, row?.id ?? ""));
    expect(after?.updatedAt.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it("puts a variant in one arm of an experiment, and shows the arm in v_publication_dimensions", async () => {
    const [exp] = await experiment({ name: "Arms" });
    const [idea] = await t.db
      .insert(masterIdeas)
      .values({
        brandId,
        topic: "Arms",
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "Synthetic",
        origin: "MANUAL",
      })
      .returning();
    const variant = (over: Partial<typeof contentVariants.$inferInsert>) =>
      t.db
        .insert(contentVariants)
        .values({ masterIdeaId: idea?.id ?? "", marketId, ...over })
        .returning();
    // An arm needs an experiment and the other way round; only A or B.
    await expect(variant({ experimentArm: "A" })).rejects.toThrow();
    await expect(variant({ experimentId: exp?.id ?? null })).rejects.toThrow();
    await expect(
      variant({ experimentId: exp?.id ?? null, experimentArm: "C" as "A" }),
    ).rejects.toThrow();
    const [v] = await variant({
      experimentId: exp?.id ?? null,
      experimentArm: "B",
      status: "PUBLISHED",
    });
    const [render] = await t.db
      .insert(carouselRenders)
      .values({ contentVariantId: v?.id ?? "", inputHash: "h", templatesVersion: "t1" })
      .returning();
    const [version] = await t.db
      .insert(contentVariantVersions)
      .values({
        contentVariantId: v?.id ?? "",
        versionNo: 1,
        snapshot: {
          hook: "Hook",
          hookType: "QUESTION",
          caption: "Caption",
          cta: { type: "SAVE", text: "Save it" },
          hashtags: [],
          slides: [],
          visualStyle: "BRIGHT",
          templateSequence: [],
          renderId: render?.id ?? "",
          renderedSlideKeys: [],
          knowledge: [],
          generationVersion: "p1.7.0",
        },
        carouselRenderId: render?.id ?? "",
        contentHash: "x",
        approvedBy: userId,
      })
      .returning();
    await t.db.insert(publications).values({
      contentVariantId: v?.id ?? "",
      contentVariantVersionId: version?.id ?? "",
      marketId,
      mode: "IMMEDIATE",
      status: "PUBLISHED",
      publishedAt: new Date("2026-10-01T10:00:00Z"),
      idempotencyKey: "pub:learning:1",
    });
    const rows = await t.db
      .select({
        experimentId: vPublicationDimensions.experimentId,
        experimentArm: vPublicationDimensions.experimentArm,
        daypart: vPublicationDimensions.daypartLocal,
      })
      .from(vPublicationDimensions);
    expect(rows).toEqual([{ experimentId: exp?.id, experimentArm: "B", daypart: "MIDDAY" }]);
  });
});
