import { schema } from "@rc/db";
import { desc, eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createFakeVideoProvider } from "@rc/lib/providers/video";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateReel } from "./generate";
import { changeReelHook, estimateShotRedo, regenerateReelShot, requestReel } from "./request";
import { type ReelFixture, reelFixture, stubAssemble } from "./test-support";
import { getReelView } from "./view";

// Changing a finished Reel: another hook (free) and one shot again (one shot's price). Synthetic content only.

describe("changing a Reel", () => {
  let t: TestDb;
  let fx: ReelFixture;
  let reelId: string;
  const video = createFakeVideoProvider();
  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reelFixture(t.db);
    await fx.setEnabled(true);
    ({ variantId: reelId } = await requestReel(fx.ctx, { carouselVariantId: fx.carouselId, confirmEstimateUsd: 2.5 }));
    await generateReel(fx.jobCtx({ video }), { variantId: reelId, requestId: "r1" }, { assemble: stubAssemble().assemble });
    fx.jobs.calls.length = 0;
    video.calls.length = 0;
  });
  afterEach(async () => {
    await t.close();
  });

  const scripts = () =>
    t.db.select().from(schema.reelScripts).where(eq(schema.reelScripts.contentVariantId, reelId)).orderBy(desc(schema.reelScripts.version));
  /** Runs the job a change queued, as the job runner would. */
  const runQueued = async () => {
    const call = fx.jobs.calls.at(-1);
    const stub = stubAssemble();
    const result = await generateReel(fx.jobCtx({ video }), call?.payload as never, { assemble: stub.assemble });
    return { result, stub };
  };

  describe("changeReelHook", () => {
    it("writes the next script with the other hook's two cards and queues the pipeline from the shots", async () => {
      const out = await changeReelHook(fx.ctx, { variantId: reelId, hookId: "h2" });
      const [next, first] = await scripts();
      expect(next).toMatchObject({ id: out.scriptId, version: 2, chosenHookId: "h2" });
      const h2 = next?.hookOptions.find((h) => h.id === "h2");
      expect(next?.scenes[0]?.card).toBe(h2?.card);
      expect(next?.scenes[1]?.card).toBe(h2?.ruleCard);
      expect(first?.chosenHookId).toBe("h1");
      expect(first?.scenes[0]?.card).not.toBe(h2?.card);
      const call = fx.jobs.calls[0];
      expect(call).toMatchObject({ name: "generate-reel", payload: { variantId: reelId, scriptId: next?.id, model: "alibaba/wan-3.0" } });
      expect(call?.options?.idempotencyKey).toMatch(new RegExp(`^reel:${reelId}:`));
      const events = await t.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.action, "reel.hook_changed"));
      expect(events[0]?.data).toMatchObject({ from: "h1", to: "h2" });
    });

    it("costs nothing: the job reuses every shot, asks no director, and makes a new video", async () => {
      await changeReelHook(fx.ctx, { variantId: reelId, hookId: "h3" });
      const { result, stub } = await runQueued();
      expect(result).toMatchObject({ status: "READY", shots: { total: 7, reused: 7 } });
      expect(video.calls).toHaveLength(0);
      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]?.scenes[0]?.card).toBe((await scripts())[0]?.hookOptions.find((h) => h.id === "h3")?.card);
      const view = await getReelView(fx.ctx, fx.carouselId);
      expect(view.reel).toMatchObject({ status: "READY_FOR_REVIEW" });
      expect(view.reel?.render.state).toBe("READY");
      expect(view.reel?.script).toMatchObject({ version: 2, chosenHookId: "h3" });
      const runs = await t.db.select().from(schema.generationRuns).where(eq(schema.generationRuns.stage, "REEL_DIRECTION"));
      expect(runs).toHaveLength(1);
    });

    it("refuses the hook already in the Reel, an unknown hook, a Reel being made, and the switch off", async () => {
      await expect(changeReelHook(fx.ctx, { variantId: reelId, hookId: "h1" })).rejects.toMatchObject({ details: { code: "hook_unchanged" } });
      await expect(changeReelHook(fx.ctx, { variantId: reelId, hookId: "h9" })).rejects.toMatchObject({ details: { code: "unknown_hook" } });
      await t.db.update(schema.contentVariants).set({ status: "GENERATING" }).where(eq(schema.contentVariants.id, reelId));
      await expect(changeReelHook(fx.ctx, { variantId: reelId, hookId: "h2" })).rejects.toMatchObject({ details: { code: "reel_generating" } });
      await t.db.update(schema.contentVariants).set({ status: "APPROVED" }).where(eq(schema.contentVariants.id, reelId));
      await expect(changeReelHook(fx.ctx, { variantId: reelId, hookId: "h2" })).rejects.toMatchObject({ details: { code: "reel_in_use" } });
      await t.db.update(schema.contentVariants).set({ status: "READY_FOR_REVIEW" }).where(eq(schema.contentVariants.id, reelId));
      await fx.setEnabled(false);
      await expect(changeReelHook(fx.ctx, { variantId: reelId, hookId: "h2" })).rejects.toMatchObject({ details: { code: "reels_disabled" } });
      expect(fx.jobs.calls).toHaveLength(0);
    });
  });

  describe("regenerateReelShot", () => {
    const confirm = () => estimateShotRedo("alibaba/wan-3.0");

    it("prices one shot of the Reel's model", () => {
      expect(estimateShotRedo("alibaba/wan-3.0")).toBeCloseTo(0.3, 4);
      expect(estimateShotRedo("bytedance/seedance-2.0")).toBeGreaterThan(estimateShotRedo("kling-video/v3.0/std"));
    });

    it("writes the next script with the scene marked for a redo and queues the pipeline", async () => {
      const out = await regenerateReelShot(fx.ctx, { variantId: reelId, sceneId: "s3", confirmEstimateUsd: confirm() });
      expect(out.estimateUsd).toBeCloseTo(0.3, 4);
      const [next] = await scripts();
      const scene = next?.scenes.find((s) => s.id === "s3");
      expect(scene).toMatchObject({ shotAttempt: 1 });
      expect(scene?.shotId).toBeUndefined();
      expect(next?.scenes.filter((s) => s.shotId)).toHaveLength(6);
      expect(fx.jobs.calls[0]?.payload).toMatchObject({ scriptId: next?.id });
    });

    it("pays for exactly that shot and makes a new video; a second redo is another shot", async () => {
      await regenerateReelShot(fx.ctx, { variantId: reelId, sceneId: "s3", confirmEstimateUsd: confirm() });
      const first = await runQueued();
      expect(first.result).toMatchObject({ status: "READY", shots: { total: 7, reused: 6 } });
      expect(video.calls).toHaveLength(1);
      expect(first.stub.calls).toHaveLength(1);
      const view = await getReelView(fx.ctx, fx.carouselId);
      expect(view.reel?.script?.scenes.find((s) => s.id === "s3")).toMatchObject({ shotAttempt: 1, shot: "READY" });

      fx.jobs.calls.length = 0;
      await regenerateReelShot(fx.ctx, { variantId: reelId, sceneId: "s3", confirmEstimateUsd: confirm() });
      const second = await runQueued();
      expect(second.result.shots).toMatchObject({ total: 7, reused: 6 });
      expect(video.calls).toHaveLength(2);
      expect((await t.db.select().from(schema.reelShots)).filter((s) => s.status === "READY")).toHaveLength(9);
    });

    it("refuses a price that is too low, an unknown scene and a Reel that cannot change", async () => {
      await expect(regenerateReelShot(fx.ctx, { variantId: reelId, sceneId: "s3", confirmEstimateUsd: 0.01 })).rejects.toMatchObject({ details: { code: "estimate_changed" } });
      await expect(regenerateReelShot(fx.ctx, { variantId: reelId, sceneId: "s99", confirmEstimateUsd: 1 })).rejects.toThrow("not in the Reel");
      await t.db.update(schema.contentVariants).set({ status: "SCHEDULED" }).where(eq(schema.contentVariants.id, reelId));
      await expect(regenerateReelShot(fx.ctx, { variantId: reelId, sceneId: "s3", confirmEstimateUsd: 1 })).rejects.toMatchObject({ details: { code: "reel_in_use" } });
      expect(fx.jobs.calls).toHaveLength(0);
    });
  });
});
