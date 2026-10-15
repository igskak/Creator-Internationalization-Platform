import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "../../content/variants/test-support";
import { getLineage } from "./lineage";
import { getReelInsights, pickD7, reelWatch } from "./reels";

// M8-10 on fixture data: the watch metrics read from a Reel's D7 snapshot, completion from the
// render's length, and the Reel next to the carousel it was made from. Synthetic numbers only.

describe("reelWatch", () => {
  it("reads milliseconds and the skip percentage, and leaves out what is missing", () => {
    expect(
      reelWatch(
        {
          ig_reels_avg_watch_time: 6200,
          ig_reels_video_view_total_time: 7_200_000,
          reels_skip_rate: 35,
        },
        20_000,
      ),
    ).toEqual({
      avgWatchSeconds: 6.2,
      totalWatchHours: 2,
      skipRate: 0.35,
      hookRate: 0.65,
      completion: 0.31,
    });
    expect(reelWatch({ reels_skip_rate: 0.4 }, null)).toMatchObject({
      skipRate: 0.4,
      completion: null,
    });
    expect(reelWatch(null, 20_000)).toEqual({
      avgWatchSeconds: null,
      totalWatchHours: null,
      skipRate: null,
      hookRate: null,
      completion: null,
    });
    // Watched longer than the Reel (loops): completion stops at 1.
    expect(reelWatch({ ig_reels_avg_watch_time: 30_000 }, 20_000).completion).toBe(1);
  });
});

describe("getReelInsights and the lineage of a Reel", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  const WINDOW = { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" };

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reviewFixture(t.db);
  });
  afterEach(async () => {
    await t.close();
  });

  const snapshot = (
    publicationId: string,
    slot: "D3" | "D7",
    age: number,
    v: Partial<typeof schema.metricSnapshots.$inferInsert>,
  ) =>
    t.db.insert(schema.metricSnapshots).values({
      publicationId,
      snapshotSlot: slot,
      measuredAt: new Date("2026-10-20T00:00:00Z"),
      mediaAgeHours: String(age),
      rawMetricsJson: {},
      apiVersion: "v25.0",
      ...v,
    });

  async function carouselAndReel() {
    // The carousel, published with a D7 reach of 2,000 and 60 saves.
    const carousel = await fx.makeVariant({ status: "PUBLISHED" });
    const cv = await fx.makeVersion(carousel.variantId);
    const carouselPub = await fx.makePublication(carousel.variantId, cv.versionId, {
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      publishedAt: new Date("2026-10-02T09:00:00Z"),
    });
    await snapshot(carouselPub, "D7", 168, { reach: 2000, saves: 60, shares: 10 });
    // The Reel made from it: a REEL variant of the same idea with a render of 20 s.
    const [c] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, carousel.variantId));
    const [reel] = await t.db
      .insert(schema.contentVariants)
      .values({
        masterIdeaId: c?.masterIdeaId ?? "",
        marketId: c?.marketId ?? "",
        format: "REEL",
        status: "PUBLISHED",
        hook: "Nunca laves el arroz",
        sourceVariantId: carousel.variantId,
      })
      .returning();
    const [script] = await t.db
      .insert(schema.reelScripts)
      .values({ contentVariantId: reel?.id ?? "", version: 1, shotModel: "alibaba/wan-3.0" })
      .returning();
    const [render] = await t.db
      .insert(schema.reelRenders)
      .values({
        contentVariantId: reel?.id ?? "",
        reelScriptId: script?.id ?? "",
        inputHash: "h",
        status: "READY",
        durationMs: 20_000,
        rendererVersion: "r1",
        storageKey: "reels/r.mp4",
        sha256: "0".repeat(64),
        bytes: 1,
      })
      .returning();
    const [version] = await t.db
      .insert(schema.contentVariantVersions)
      .values({
        contentVariantId: reel?.id ?? "",
        versionNo: 1,
        snapshot: {
          format: "REEL",
          hook: "Nunca laves el arroz",
          hookType: "MISTAKE_CALLOUT",
          caption: "Guárdalo.",
          cta: { type: "SAVE", text: "Guárdalo" },
          hashtags: [],
          slides: [],
          visualStyle: "WARM",
          templateSequence: [],
          renderId: "r",
          renderedSlideKeys: [],
          knowledge: [],
          generationVersion: "p1.7.0",
        } as never,
        reelRenderId: render?.id ?? null,
        contentHash: "r",
        approvedBy: fx.userId,
      })
      .returning();
    const reelPub = await fx.makePublication(reel?.id ?? "", version?.id ?? "", {
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      publishedAt: new Date("2026-10-03T18:00:00Z"),
    });
    await snapshot(reelPub, "D3", 72, {
      reach: 900,
      views: 1500,
      videoMetricsJson: { ig_reels_avg_watch_time: 5000 },
    });
    await snapshot(reelPub, "D7", 168, {
      reach: 3000,
      views: 5000,
      saves: 30,
      shares: 6,
      videoMetricsJson: {
        ig_reels_avg_watch_time: 8000,
        ig_reels_video_view_total_time: 36_000_000,
        reels_skip_rate: 30,
      },
    });
    return { reelPub, carouselPub };
  }

  it("gives each Reel its D7 watch numbers next to its carousel", async () => {
    const { reelPub, carouselPub } = await carouselAndReel();
    const insights = await getReelInsights(fx.ctx, WINDOW);
    expect(insights.reels).toHaveLength(1);
    expect(insights.reels[0]).toMatchObject({
      publicationId: reelPub,
      slot: "D7",
      isExactD7: true,
      views: 5000,
      reach: 3000,
      saveRate: 0.01,
      durationSeconds: 20,
      watch: { avgWatchSeconds: 8, totalWatchHours: 10, skipRate: 0.3, completion: 0.4 },
      carousel: { publicationId: carouselPub, reach: 2000, saveRate: 0.03 },
    });
    expect(insights.reels[0]?.watch.hookRate).toBeCloseTo(0.7, 10);
    expect(insights.tiles).toMatchObject({
      reels: 1,
      measured: 1,
      medianViews: 5000,
      medianReachVsCarousel: 1.5,
    });

    const lineage = await getLineage(fx.ctx, { publicationId: reelPub });
    expect(lineage.metrics.watch).toMatchObject({ avgWatchSeconds: 8, completion: 0.4 });
    const carouselLineage = await getLineage(fx.ctx, { publicationId: carouselPub });
    expect(carouselLineage.metrics.watch).toBeNull();
  });

  it("chooses the snapshot as the D7 view does", () => {
    const s = (slot: string, age: number, at: string) =>
      ({ snapshotSlot: slot, mediaAgeHours: String(age), measuredAt: new Date(at) }) as never;
    expect(pickD7([s("H2", 2, "2026-10-01"), s("D1", 24, "2026-10-02")])).toBeNull();
    expect(pickD7([s("D3", 72, "2026-10-03"), s("D28", 672, "2026-10-28")])).toMatchObject({
      snapshotSlot: "D3",
    });
    expect(pickD7([s("MANUAL", 160, "2026-10-08"), s("MANUAL", 176, "2026-10-09")])).toMatchObject({
      mediaAgeHours: "176",
    });
  });
});
