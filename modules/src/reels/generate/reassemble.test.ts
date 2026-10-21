import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createFakeImageProvider } from "@rc/lib/providers/image";
import { createFakeVideoProvider } from "@rc/lib/providers/video";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GenerateReelPayload, generateReel } from "./generate";
import { reassembleReel, requestReel } from "./request";
import { type ReelFixture, reelFixture, stubAssemble } from "./test-support";

// A Reel whose video could not be assembled has paid shots and a script. Rebuilding it must reuse
// them: a new script (what "Generate again" writes) hashes to new shots and pays for them again.
// Synthetic content only.

describe("reassembleReel", () => {
  let t: TestDb;
  let fx: ReelFixture;
  let reelId: string;
  const video = createFakeVideoProvider();
  const images = createFakeImageProvider();
  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reelFixture(t.db);
    await fx.setEnabled(true);
    ({ variantId: reelId } = await requestReel(fx.ctx, {
      carouselVariantId: fx.carouselId,
      confirmEstimateUsd: 2.8,
    }));
    // The first try: the director and the six shots are paid, then ffmpeg fails.
    const failed = await generateReel(
      fx.jobCtx({ video, images }),
      { variantId: reelId, requestId: "r1" },
      {
        assemble: async () => {
          throw new Error(
            "Cannot select channel layout for the link between filters Parsed_aresample_26 and format_out_0_1.",
          );
        },
      },
    );
    expect(failed.status).toBe("FAILED");
    fx.jobs.calls.length = 0;
    video.calls.length = 0;
    images.calls.length = 0;
  });
  afterEach(async () => {
    await t.close();
  });

  const variant = async () => fx.variant(reelId);
  const scripts = () => t.db.select().from(schema.reelScripts);
  const shots = () => t.db.select().from(schema.reelShots);
  const renders = () => t.db.select().from(schema.reelRenders);
  const directorRuns = () =>
    t.db
      .select()
      .from(schema.generationRuns)
      .where(eq(schema.generationRuns.stage, "REEL_DIRECTION"));

  it("queues the job on the latest script with assembleOnly, and writes no new script", async () => {
    expect((await variant()).status).toBe("DRAFT");
    const [script] = await scripts();
    const out = await reassembleReel(fx.ctx, { variantId: reelId });
    expect(out).toMatchObject({ variantId: reelId, scriptId: script?.id });
    expect(await scripts()).toHaveLength(1);
    expect(fx.jobs.calls[0]).toMatchObject({
      name: "generate-reel",
      payload: {
        variantId: reelId,
        scriptId: script?.id,
        assembleOnly: true,
        model: "alibaba/wan-3.0",
      },
    });
    const events = await t.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "reel.reassembled"));
    expect(events).toHaveLength(1);
  });

  it("rebuilds the video from the stored shots without a director, a picture or a shot", async () => {
    await reassembleReel(fx.ctx, { variantId: reelId });
    const stub = stubAssemble();
    const queued = GenerateReelPayload.parse(fx.jobs.calls.at(-1)?.payload);
    const paid = (await renders())[0]?.costUsd;
    const result = await generateReel(fx.jobCtx({ video, images }), queued, {
      assemble: stub.assemble,
    });

    expect(result).toMatchObject({ status: "READY", shots: { total: 6, reused: 6 } });
    expect(video.calls).toHaveLength(0);
    expect(images.calls).toHaveLength(0);
    expect(await directorRuns()).toHaveLength(1);
    expect(await scripts()).toHaveLength(1);
    expect(await shots()).toHaveLength(6);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.audio).toEqual({ kind: "MODEL_AUDIO" });
    expect(Object.keys(stub.calls[0]?.shots ?? {})).toHaveLength(6);

    expect(await variant()).toMatchObject({
      status: "READY_FOR_REVIEW",
      lastError: null,
      pipelineState: null,
    });
    // The failed render row of the first try became the ready one; what it cost is kept.
    const rows = await renders();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "READY", error: null });
    expect(rows[0]?.costUsd).toBe(paid);
    expect(Number(rows[0]?.costUsd)).toBeGreaterThan(0);
  });

  it("refuses to rebuild when a scene has no finished shot, before anything is queued", async () => {
    const [first] = await shots();
    await t.db
      .update(schema.reelShots)
      .set({ status: "FAILED" })
      .where(eq(schema.reelShots.id, first?.id ?? ""));
    await expect(reassembleReel(fx.ctx, { variantId: reelId })).rejects.toMatchObject({
      details: { code: "shots_missing" },
    });
    expect(fx.jobs.calls).toHaveLength(0);
  });

  it("ends the job without paying when a shot went missing after it was queued", async () => {
    await reassembleReel(fx.ctx, { variantId: reelId });
    const [first] = await shots();
    await t.db
      .update(schema.reelShots)
      .set({ status: "FAILED" })
      .where(eq(schema.reelShots.id, first?.id ?? ""));
    const stub = stubAssemble();
    const result = await generateReel(
      fx.jobCtx({ video, images }),
      GenerateReelPayload.parse(fx.jobs.calls.at(-1)?.payload),
      { assemble: stub.assemble },
    );
    expect(result).toMatchObject({ status: "FAILED", error: { code: "shots_missing" } });
    expect(video.calls).toHaveLength(0);
    expect(images.calls).toHaveLength(0);
    expect(stub.calls).toHaveLength(0);
  });

  it("is refused while the Reel is being made or already approved", async () => {
    await t.db
      .update(schema.contentVariants)
      .set({ status: "APPROVED" })
      .where(eq(schema.contentVariants.id, reelId));
    await expect(reassembleReel(fx.ctx, { variantId: reelId })).rejects.toMatchObject({
      details: { code: "reel_in_use" },
    });
  });

  it("needs a script to rebuild from", () => {
    expect(() =>
      GenerateReelPayload.parse({ variantId: reelId, requestId: "r", assembleOnly: true }),
    ).toThrow(/scriptId/);
  });
});
