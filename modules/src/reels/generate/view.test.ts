import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createFakeVideoProvider } from "@rc/lib/providers/video";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateReel } from "./generate";
import { requestReel } from "./request";
import { type ReelFixture, reelFixture, stubAssemble } from "./test-support";
import { getReelView, getReelViews } from "./view";

// Synthetic content only.

describe("getReelView", () => {
  let t: TestDb;
  let fx: ReelFixture;
  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reelFixture(t.db);
  });
  afterEach(async () => {
    await t.close();
  });

  const view = () => getReelView(fx.ctx, fx.carouselId);

  it("says the button is off while the switch is off, with the price of every model", async () => {
    const v = await view();
    expect(v).toMatchObject({ enabled: false, blockedBy: "reels_disabled", reel: null });
    expect(Object.keys(v.estimates).sort()).toEqual([
      "alibaba/wan-3.0",
      "bytedance/seedance-2.0",
      "kling-video/v3.0/std",
    ]);
    expect(v.estimates["alibaba/wan-3.0"].totalUsd).toBeCloseTo(2.2, 3);
  });

  it("is open once the switch is on and the carousel is finished", async () => {
    await fx.setEnabled(true);
    expect(await view()).toMatchObject({ enabled: true, blockedBy: null, reel: null });
  });

  it("explains a carousel that is not ready or has no pictures", async () => {
    await fx.setEnabled(true);
    await t.db.update(schema.visualAssets).set({ status: "FAILED" });
    expect((await view()).blockedBy).toBe("no_pictures");
    await t.db.update(schema.visualAssets).set({ status: "READY" });
    await t.db
      .update(schema.contentVariants)
      .set({ status: "GENERATING" })
      .where(eq(schema.contentVariants.id, fx.carouselId));
    expect((await view()).blockedBy).toBe("carousel_not_ready");
  });

  it("shows a Reel being made: the stage, the shots done so far and no video yet", async () => {
    await fx.setEnabled(true);
    const { variantId } = await requestReel(fx.ctx, {
      carouselVariantId: fx.carouselId,
      confirmEstimateUsd: 2.5,
    });
    await t.db
      .update(schema.contentVariants)
      .set({
        status: "GENERATING",
        pipelineState: {
          pipelineRunId: `reel:${variantId}:r1`,
          stage: "SHOTS",
          startedAt: "2026-10-10T12:00:00.000Z",
          completedStages: ["DIRECTION"],
          runIds: { SHOTS_READY: "3" },
        },
      })
      .where(eq(schema.contentVariants.id, variantId));
    const v = await view();
    expect(v.blockedBy).toBe("reel_generating");
    expect(v.reel).toMatchObject({
      variantId,
      status: "GENERATING",
      changeable: false,
      stage: { current: "SHOTS", completed: ["DIRECTION"], shotsReady: 3, shotsTotal: null },
      render: { state: "RENDERING", playUrl: null },
    });
  });

  describe("a finished Reel", () => {
    let reelId: string;
    beforeEach(async () => {
      await fx.setEnabled(true);
      ({ variantId: reelId } = await requestReel(fx.ctx, {
        carouselVariantId: fx.carouselId,
        confirmEstimateUsd: 2.5,
      }));
      await generateReel(
        fx.jobCtx({ video: createFakeVideoProvider() }),
        { variantId: reelId, requestId: "r1" },
        { assemble: stubAssemble().assemble },
      );
    });

    it("has the script, the scenes with their shots, the video links and the cost", async () => {
      const v = await view();
      const reel = v.reel;
      expect(reel).toMatchObject({
        variantId: reelId,
        status: "READY_FOR_REVIEW",
        changeable: true,
        stage: null,
        lastError: null,
      });
      expect(v.blockedBy).toBeNull();
      expect(reel?.script).toMatchObject({
        version: 1,
        chosenHookId: "h1",
        flashOpener: "ON",
        model: "alibaba/wan-3.0",
      });
      expect(reel?.script?.hookOptions.map((h) => h.id)).toEqual(["h1", "h2", "h3"]);
      expect(reel?.script?.scenes).toHaveLength(7);
      expect(reel?.script?.scenes[0]).toMatchObject({
        id: "s1",
        role: "HOOK",
        shot: "READY",
        shotAttempt: 0,
      });
      expect(
        reel?.script?.scenes.every((s) => s.shot === "READY" && (s.shotCostUsd ?? 0) > 0),
      ).toBe(true);
      expect(reel?.render).toMatchObject({
        state: "READY",
        width: 1080,
        height: 1920,
        durationMs: 14_880,
        warnings: [],
      });
      expect(reel?.render.playUrl).toBeTruthy();
      expect(reel?.render.downloadUrl).toBeTruthy();
      // Seven shots of $0.30 and the fake director's run.
      expect(reel?.costUsd).toBeGreaterThan(2.1);
      expect(reel?.costUsd).toBeLessThan(2.2);
    });

    it("calls the video stale when a newer script exists than the one it was made from", async () => {
      const [script] = await t.db.select().from(schema.reelScripts);
      await t.db.insert(schema.reelScripts).values({
        contentVariantId: reelId,
        version: 2,
        hookOptions: script?.hookOptions ?? [],
        chosenHookId: "h2",
        scenes: script?.scenes ?? [],
        shotModel: script?.shotModel ?? "alibaba/wan-3.0",
      });
      expect((await view()).reel?.render.state).toBe("STALE");
    });

    it("shows a failed render when there is no video", async () => {
      await t.db
        .update(schema.contentVariants)
        .set({ currentReelRenderId: null })
        .where(eq(schema.contentVariants.id, reelId));
      await t.db
        .update(schema.reelRenders)
        .set({ status: "FAILED", error: { code: "ASSEMBLY_FAILED", message: "ffmpeg exploded" } });
      expect((await view()).reel?.render).toMatchObject({
        state: "FAILED",
        error: "ffmpeg exploded",
        playUrl: null,
      });
    });

    it("says an approved Reel is in use", async () => {
      await t.db
        .update(schema.contentVariants)
        .set({ status: "APPROVED" })
        .where(eq(schema.contentVariants.id, reelId));
      const v = await view();
      expect(v.blockedBy).toBe("reel_in_use");
      expect(v.reel?.changeable).toBe(false);
    });

    it("answers for several carousels at once", async () => {
      const views = await getReelViews(fx.ctx, [fx.carouselId]);
      expect(Object.keys(views)).toEqual([fx.carouselId]);
      expect(views[fx.carouselId]?.reel?.variantId).toBe(reelId);
    });
  });
});
