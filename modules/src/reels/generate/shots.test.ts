import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { PermanentError, TransientError } from "@rc/lib/errors";
import {
  createFakeVideoProvider,
  type GeneratedShot,
  type ShotHandle,
  type VideoProvider,
} from "@rc/lib/providers/video";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureShot,
  ensureShots,
  FALLBACK_SHOT_PROMPT,
  prepareStartFrame,
  type ShotSpec,
  shotPromptHash,
  shotSecondsFor,
} from "./shots";
import { type ReelFixture, reelFixture } from "./test-support";

// Synthetic content only.

const frameOf = async (color = "#cc8844") =>
  prepareStartFrame(
    await sharp({ create: { width: 540, height: 675, channels: 3, background: color } })
      .png()
      .toBuffer(),
  );

describe("prepareStartFrame", () => {
  it("pads a picture to 720 × 1280 on pure white and hashes the result", async () => {
    const frame = await frameOf();
    const meta = await sharp(frame.bytes).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([720, 1280, "jpeg"]);
    const { data } = await sharp(frame.bytes).raw().toBuffer({ resolveWithObject: true });
    // The top-left corner is the white padding.
    expect([data[0], data[1], data[2]].every((v) => (v ?? 0) >= 253)).toBe(true);
    expect(frame.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await frameOf()).sha256).toBe(frame.sha256);
    expect((await frameOf("#112233")).sha256).not.toBe(frame.sha256);
  });

  it("flattens a cut-out with transparency onto white", async () => {
    const cutout = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const frame = await prepareStartFrame(cutout);
    const { data } = await sharp(frame.bytes)
      .resize(8, 8)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Math.min(...data)).toBeGreaterThanOrEqual(253);
  });
});

describe("shotPromptHash and shotSecondsFor", () => {
  const base = {
    model: "alibaba/wan-3.0",
    resolution: "720p",
    seconds: 3,
    prompt: "p",
    frameSha256: "a",
  } as const;
  it("changes with every part of a shot", () => {
    const h = shotPromptHash(base);
    expect(shotPromptHash({ ...base })).toBe(h);
    for (const change of [
      { model: "kling-video/v3.0/std" },
      { resolution: "480p" },
      { seconds: 4 },
      { prompt: "q" },
      { frameSha256: "b" },
    ] as const) {
      expect(shotPromptHash({ ...base, ...change }), JSON.stringify(change)).not.toBe(h);
    }
  });

  it("is three seconds, or the model's minimum when higher", () => {
    expect(shotSecondsFor("alibaba/wan-3.0")).toBe(3);
    expect(shotSecondsFor("kling-video/v3.0/std")).toBe(3);
    expect(shotSecondsFor("bytedance/seedance-2.0")).toBe(4);
  });
});

describe("ensureShot", () => {
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

  const shotCtx = async () => {
    const [variant] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, fx.carouselId));
    const [idea] = await t.db
      .select()
      .from(schema.masterIdeas)
      .where(eq(schema.masterIdeas.id, variant?.masterIdeaId ?? ""));
    return {
      brandId: idea?.brandId ?? "",
      variantId: fx.carouselId,
      masterIdeaId: idea?.id ?? "",
      model: "alibaba/wan-3.0" as const,
      resolution: "720p" as const,
    };
  };
  const spec = async (
    sceneId = "s1",
    prompt = "Static camera. Rice grains toast in a pan.",
  ): Promise<ShotSpec> => ({
    sceneId,
    prompt,
    pictureId: fx.assetIds[0] ?? "",
    frame: await frameOf(),
  });
  const rows = () => t.db.select().from(schema.reelShots);

  /** A provider whose shots are refused or delayed on demand. */
  function scripted(rule: {
    refuse?: (prompt: string) => boolean;
    stall?: boolean;
  }): VideoProvider & { submits: string[]; waits: string[] } {
    const inner = createFakeVideoProvider();
    const prompts = new Map<string, string>();
    const submits: string[] = [];
    const waits: string[] = [];
    return {
      id: "fake",
      model: inner.model,
      submits,
      waits,
      submit: async (request) => {
        const handle = await inner.submit(request);
        prompts.set(handle.requestId, request.prompt);
        submits.push(request.prompt);
        return handle;
      },
      waitFor: async (handle: ShotHandle): Promise<GeneratedShot> => {
        waits.push(handle.requestId);
        if (rule.refuse?.(prompts.get(handle.requestId) ?? "")) {
          throw new PermanentError("Higgsfield blocked the shot (moderation).", {
            details: { code: "nsfw" },
          });
        }
        if (rule.stall)
          throw new TransientError("Higgsfield is still working on the shot.", {
            details: { code: "timeout" },
          });
        return inner.waitFor(handle);
      },
      generate: async (request, wait) => inner.waitFor(await inner.submit(request), wait),
    };
  }

  it("makes a shot: row READY, the mp4 in storage, a REEL_SHOT run with the cost", async () => {
    const video = createFakeVideoProvider();
    const ctx = fx.jobCtx({ video });
    const result = await ensureShot(ctx, await shotCtx(), await spec());
    expect(result).toMatchObject({ sceneId: "s1", reused: false, usedFallback: false });
    expect(result.costUsd).toBeCloseTo(0.3, 4);
    const [row] = await rows();
    expect(row).toMatchObject({
      status: "READY",
      model: "alibaba/wan-3.0",
      durationSeconds: 3,
      resolution: "720p",
    });
    expect(row?.providerRequestId).toMatch(/^fake-/);
    expect(await fx.storage.head(row?.storageKey ?? "")).not.toBeNull();
    expect(row?.sha256).toBe(result.sha256);
    const runs = await t.db
      .select()
      .from(schema.generationRuns)
      .where(eq(schema.generationRuns.stage, "REEL_SHOT"));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "SUCCEEDED",
      promptId: "video-shot",
      id: row?.generationRunId,
    });
    expect(video.calls[0]?.idempotencyKey).toBe(`reel-shot:${row?.promptHash}`);
  });

  it("finds a READY shot of the same prompt and picture again and pays nothing", async () => {
    const video = createFakeVideoProvider();
    const ctx = fx.jobCtx({ video });
    await ensureShot(ctx, await shotCtx(), await spec("s1"));
    const again = await ensureShot(ctx, await shotCtx(), await spec("s5"));
    expect(again).toMatchObject({ reused: true, sceneId: "s5" });
    expect(video.calls).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("makes another shot for another prompt or another picture", async () => {
    const video = createFakeVideoProvider();
    const ctx = fx.jobCtx({ video });
    await ensureShot(ctx, await shotCtx(), await spec("s1", "Static camera. One."));
    await ensureShot(ctx, await shotCtx(), await spec("s2", "Static camera. Two."));
    expect(video.calls).toHaveLength(2);
    expect(await rows()).toHaveLength(2);
  });

  it("waits again for a request that is RUNNING instead of submitting a second one", async () => {
    const stalled = scripted({ stall: true });
    await expect(
      ensureShot(fx.jobCtx({ video: stalled }), await shotCtx(), await spec()),
    ).rejects.toBeInstanceOf(TransientError);
    const [running] = await rows();
    expect(running).toMatchObject({ status: "RUNNING" });
    expect(running?.providerRequestId).toBeTruthy();

    const healthy = scripted({});
    const result = await ensureShot(fx.jobCtx({ video: healthy }), await shotCtx(), await spec());
    expect(result.reused).toBe(false);
    expect(healthy.submits).toHaveLength(0);
    expect(healthy.waits).toEqual([running?.providerRequestId]);
    expect((await rows())[0]).toMatchObject({ status: "READY" });
  });

  it("retries a refused shot once with the fallback prompt and marks the first BLOCKED", async () => {
    const video = scripted({ refuse: (p) => p !== FALLBACK_SHOT_PROMPT });
    const result = await ensureShot(fx.jobCtx({ video }), await shotCtx(), await spec());
    expect(result).toMatchObject({ usedFallback: true, reused: false });
    expect(video.submits).toEqual([
      "Static camera. Rice grains toast in a pan.",
      FALLBACK_SHOT_PROMPT,
    ]);
    const all = await rows();
    expect(all.map((r) => r.status).sort()).toEqual(["BLOCKED", "READY"]);
    expect(all.find((r) => r.status === "BLOCKED")?.error).toMatchObject({ code: "nsfw" });
    const runs = await t.db
      .select()
      .from(schema.generationRuns)
      .where(eq(schema.generationRuns.stage, "REEL_SHOT"));
    expect(runs.map((r) => r.status).sort()).toEqual(["FAILED", "SUCCEEDED"]);
  });

  it("stops with the error when the fallback is refused too", async () => {
    const video = scripted({ refuse: () => true });
    await expect(
      ensureShot(fx.jobCtx({ video }), await shotCtx(), await spec()),
    ).rejects.toMatchObject({ details: { code: "nsfw" } });
    expect((await rows()).map((r) => r.status)).toEqual(["BLOCKED", "BLOCKED"]);
  });

  it("does not retry a refusal that is a billing problem", async () => {
    const video: VideoProvider = {
      ...createFakeVideoProvider(),
      submit: async () => {
        throw new PermanentError("The Higgsfield balance is too low for this shot.", {
          details: { code: "payment_required" },
        });
      },
    };
    await expect(
      ensureShot(fx.jobCtx({ video }), await shotCtx(), await spec()),
    ).rejects.toMatchObject({
      details: { code: "payment_required" },
    });
    expect((await rows()).map((r) => r.status)).toEqual(["PENDING"]);
  });

  it("makes several shots at once and reports each failure on its own", async () => {
    const inner = createFakeVideoProvider({
      fail: (request) =>
        request.prompt.includes("Bad") ? new PermanentError("rejected") : undefined,
    });
    const specs = [
      await spec("s1", "Static camera. Good one."),
      await spec("s2", "Static camera. Bad one."),
      await spec("s3", "Static camera. Good two."),
    ];
    const { results, failures } = await ensureShots(
      fx.jobCtx({ video: inner }),
      await shotCtx(),
      specs,
    );
    expect(results.map((r) => r.sceneId).sort()).toEqual(["s1", "s3"]);
    expect(failures.map((f) => f.sceneId)).toEqual(["s2"]);
  });
});
