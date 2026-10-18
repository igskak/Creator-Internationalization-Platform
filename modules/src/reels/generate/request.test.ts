import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateReelCost, requestReel } from "./request";
import { type ReelFixture, reelFixture } from "./test-support";

// Synthetic content only.

describe("the Generate Reel services", () => {
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

  const reels = () =>
    t.db.select().from(schema.contentVariants).where(eq(schema.contentVariants.format, "REEL"));
  const request = (over: Record<string, unknown> = {}) =>
    requestReel(fx.ctx, { carouselVariantId: fx.carouselId, confirmEstimateUsd: 2.5, ...over });

  describe("estimateReelCost", () => {
    it("gives the estimate and says the button is off while the switch is off", async () => {
      const view = await estimateReelCost(fx.ctx, { carouselVariantId: fx.carouselId });
      expect(view.estimate.totalUsd).toBeCloseTo(2.2, 3);
      expect(view).toMatchObject({
        enabled: false,
        blockedBy: "reels_disabled",
        reelVariantId: null,
      });
    });

    it("is open once the switch is on, and prices another model", async () => {
      await fx.setEnabled(true);
      const view = await estimateReelCost(fx.ctx, {
        carouselVariantId: fx.carouselId,
        model: "bytedance/seedance-2.0",
      });
      expect(view).toMatchObject({ enabled: true, blockedBy: null });
      expect(view.estimate.secondsPerShot).toBe(4);
    });

    it("says why a Reel cannot be made again: it is being made, or it is approved", async () => {
      await fx.setEnabled(true);
      await request();
      const [reel] = await reels();
      await t.db
        .update(schema.contentVariants)
        .set({ status: "GENERATING" })
        .where(eq(schema.contentVariants.id, reel?.id ?? ""));
      expect(await estimateReelCost(fx.ctx, { carouselVariantId: fx.carouselId })).toMatchObject({
        blockedBy: "reel_generating",
        reelVariantId: reel?.id,
      });
      await t.db
        .update(schema.contentVariants)
        .set({ status: "APPROVED" })
        .where(eq(schema.contentVariants.id, reel?.id ?? ""));
      expect((await estimateReelCost(fx.ctx, { carouselVariantId: fx.carouselId })).blockedBy).toBe(
        "reel_in_use",
      );
    });

    it("refuses a carousel that is not finished, one with no pictures, and one that does not exist", async () => {
      await t.db
        .update(schema.contentVariants)
        .set({ status: "GENERATING" })
        .where(eq(schema.contentVariants.id, fx.carouselId));
      await expect(
        estimateReelCost(fx.ctx, { carouselVariantId: fx.carouselId }),
      ).rejects.toMatchObject({
        details: { code: "carousel_not_ready" },
      });
      await t.db
        .update(schema.contentVariants)
        .set({ status: "READY_FOR_REVIEW" })
        .where(eq(schema.contentVariants.id, fx.carouselId));
      await t.db.update(schema.visualAssets).set({ status: "FAILED" });
      await expect(
        estimateReelCost(fx.ctx, { carouselVariantId: fx.carouselId }),
      ).rejects.toMatchObject({
        details: { code: "no_pictures" },
      });
      await expect(
        estimateReelCost(fx.ctx, { carouselVariantId: "11111111-1111-4111-8111-111111111111" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("requestReel", () => {
    it("spends nothing and creates nothing while the switch is off", async () => {
      await expect(request()).rejects.toMatchObject({ details: { code: "reels_disabled" } });
      expect(await reels()).toHaveLength(0);
      expect(fx.jobs.calls).toHaveLength(0);
    });

    it("refuses an estimate that is too low and says the new amount", async () => {
      await fx.setEnabled(true);
      await expect(request({ confirmEstimateUsd: 1 })).rejects.toBeInstanceOf(ValidationError);
      await expect(request({ confirmEstimateUsd: 1 })).rejects.toMatchObject({
        details: { code: "estimate_changed", estimateUsd: expect.any(Number) },
      });
      expect(fx.jobs.calls).toHaveLength(0);
    });

    it("accepts an estimate a cent or two under the current one", async () => {
      await fx.setEnabled(true);
      const result = await request({ confirmEstimateUsd: 2.19 });
      expect(result.estimate.totalUsd).toBeCloseTo(2.2, 3);
    });

    it("creates the Reel variant of the post and queues the job with an idempotency key", async () => {
      await fx.setEnabled(true);
      const result = await request({ hookId: "h2", model: "kling-video/v3.0/std" });
      const [reel] = await reels();
      const [carousel] = await t.db
        .select()
        .from(schema.contentVariants)
        .where(eq(schema.contentVariants.id, fx.carouselId));
      expect(reel).toMatchObject({
        id: result.variantId,
        format: "REEL",
        status: "DRAFT",
        sourceVariantId: fx.carouselId,
        masterIdeaId: carousel?.masterIdeaId,
        marketId: carousel?.marketId,
        caption: carousel?.caption,
        ctaType: carousel?.ctaType,
      });
      expect(fx.jobs.calls).toHaveLength(1);
      const call = fx.jobs.calls[0];
      expect(call?.name).toBe("generate-reel");
      expect(call?.payload).toMatchObject({
        variantId: reel?.id,
        hookId: "h2",
        model: "kling-video/v3.0/std",
      });
      const requestId = (call?.payload as { requestId: string } | undefined)?.requestId;
      expect(call?.options?.idempotencyKey).toBe(`reel:${reel?.id}:${requestId}`);
      const events = await t.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "reel.requested"));
      expect(events[0]?.data).toMatchObject({
        sourceVariantId: fx.carouselId,
        model: "kling-video/v3.0/std",
        confirmedUsd: 2.5,
      });
    });

    it("reuses the Reel variant of the post on a second request", async () => {
      await fx.setEnabled(true);
      const first = await request();
      const second = await request();
      expect(second.variantId).toBe(first.variantId);
      expect(await reels()).toHaveLength(1);
      expect(fx.jobs.calls).toHaveLength(2);
    });

    it("refuses while a Reel is being made and when the Reel is already approved", async () => {
      await fx.setEnabled(true);
      const { variantId } = await request();
      await t.db
        .update(schema.contentVariants)
        .set({ status: "GENERATING" })
        .where(eq(schema.contentVariants.id, variantId));
      await expect(request()).rejects.toMatchObject({ details: { code: "reel_generating" } });
      await t.db
        .update(schema.contentVariants)
        .set({ status: "SCHEDULED" })
        .where(eq(schema.contentVariants.id, variantId));
      await expect(request()).rejects.toBeInstanceOf(InvalidStateError);
      await expect(request()).rejects.toMatchObject({ details: { code: "reel_in_use" } });
      expect(fx.jobs.calls).toHaveLength(1);
    });

    it("makes a new version of a published Reel and leaves the published one as it is", async () => {
      await fx.setEnabled(true);
      const { variantId } = await request();
      await t.db
        .update(schema.contentVariants)
        .set({ status: "PUBLISHED" })
        .where(eq(schema.contentVariants.id, variantId));
      expect(await estimateReelCost(fx.ctx, { carouselVariantId: fx.carouselId })).toMatchObject({
        blockedBy: null,
        reelVariantId: null,
      });
      const next = await request();
      expect(next.variantId).not.toBe(variantId);
      const rows = await reels();
      expect(rows.map((r) => r.status).sort()).toEqual(["DRAFT", "PUBLISHED"]);
    });

    it("allows a new Reel after the old one was rejected", async () => {
      await fx.setEnabled(true);
      const { variantId } = await request();
      await t.db
        .update(schema.contentVariants)
        .set({ status: "REJECTED" })
        .where(eq(schema.contentVariants.id, variantId));
      const next = await request();
      expect(next.variantId).not.toBe(variantId);
      expect((await reels()).filter((r) => r.status !== "REJECTED")).toHaveLength(1);
    });
  });
});
