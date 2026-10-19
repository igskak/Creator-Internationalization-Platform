import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, ValidationError } from "@rc/lib/errors";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { reelReviewFacts } from "../../content";
import { type AttachedReelScript, attachReelVideo } from "./attach";
import { changeReelHook, regenerateReelShot } from "./request";
import { type ReelFixture, reelFixture } from "./test-support";

// Attaching a Reel video made outside the app (`pnpm rc reel-attach`), with real ffprobe on small
// synthetic clips. Skipped without ffmpeg.

const haveFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const tmp = mkdtempSync(join(tmpdir(), "reel-attach-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A silent-free test clip: grey frame with a moving square and a tone. */
function clip(name: string, size = "1080x1920", seconds = 9): string {
  const path = join(tmp, name);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=0xf4f4f4:s=${size}:r=30:d=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    `color=c=0x222222:s=600x600:r=30:d=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    "-filter_complex",
    "[0:v][1:v]overlay=x='mod(600*t,480)':y=700,format=yuv420p[v]",
    "-map",
    "[v]",
    "-map",
    "2:a",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-t",
    String(seconds),
    path,
  ]);
  return path;
}

const SCRIPT: AttachedReelScript = {
  hookOptions: [
    {
      id: "h1",
      hookType: "MISTAKE_CALLOUT",
      card: "¿Aún lavas el arroz **del risotto?**",
      ruleCard: "Ahí se va lo **meloso.**",
      claimSlideIds: ["c2", "c3"],
      rationale: "Doubts a familiar action.",
    },
  ],
  chosenHookId: "h1",
  scenes: [
    {
      role: "HOOK",
      emotion: "DOUBT",
      beats: 6,
      card: "¿Aún lavas el arroz **del risotto?**",
      shotPrompt: "Static camera. Water streams through a sieve of rice.",
      claimSlideIds: [],
    },
    {
      role: "RULE",
      emotion: "AHA",
      beats: 6,
      card: "Ahí se va lo **meloso.**",
      line: "El almidón de la superficie es lo que hace el risotto meloso.",
      framePrompt: "Arborio rice in cloudy water in a charcoal ceramic bowl.",
      shotPrompt: "Static camera. Cloudy water swirls around the rice.",
      claimSlideIds: ["c2"],
    },
    {
      role: "PAYOFF",
      emotion: "SAVE_IT",
      beats: 6,
      card: "No laves el arroz **del risotto.**",
      line: "Mándaselo a quien hace el risotto en casa.",
      shotPrompt: "Static camera. Steam rises over the risotto.",
      claimSlideIds: [],
    },
  ],
  post: {
    body: "El almidón de la superficie es lo que hace el risotto meloso.\n\nMándaselo a quien hace el risotto en casa.",
    cta: { type: "SHARE", text: "Mándaselo a quien hace el risotto en casa." },
    hashtags: ["#risotto", "#arroz"],
  },
};

describe.skipIf(!haveFfmpeg)("attachReelVideo", () => {
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

  it("makes a Reel draft of the carousel with the video, its script and its post, ready for review", async () => {
    const video = clip("ok.mp4");
    const result = await attachReelVideo(fx.ctx, {
      carouselVariantId: fx.carouselId,
      videoPath: video,
      script: SCRIPT,
      costUsd: 1.6,
    });
    expect(result).toMatchObject({ created: true, scriptVersion: 1, warnings: [] });
    expect(Math.abs(result.durationMs - 9_000)).toBeLessThan(150);

    const [reel] = await reels();
    expect(reel).toMatchObject({
      id: result.variantId,
      status: "READY_FOR_REVIEW",
      sourceVariantId: fx.carouselId,
      currentReelRenderId: result.renderId,
      hook: "¿Aún lavas el arroz del risotto?",
      hookType: "MISTAKE_CALLOUT",
      ctaType: "SHARE",
      hashtags: ["#risotto", "#arroz"],
    });
    expect(reel?.caption?.startsWith("¿Aún lavas el arroz del risotto? Ahí se va lo meloso.")).toBe(
      true,
    );

    const [script] = await t.db
      .select()
      .from(schema.reelScripts)
      .where(eq(schema.reelScripts.id, result.scriptId));
    expect(script).toMatchObject({ shotModel: "attached", promptVersion: "attached" });
    expect(script?.scenes.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(script?.scenes[1]).toMatchObject({
      line: "El almidón de la superficie es lo que hace el risotto meloso.",
      layout: "FULL",
      sourcePictureId: fx.assetIds[0],
    });

    const [render] = await t.db
      .select()
      .from(schema.reelRenders)
      .where(eq(schema.reelRenders.id, result.renderId));
    expect(render).toMatchObject({
      status: "READY",
      width: 1080,
      height: 1920,
      audioKind: "MODEL_AUDIO",
      rendererVersion: "attached",
      costUsd: "1.6000",
    });
    expect(render?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await fx.storage.head(render?.storageKey ?? "")).toMatchObject({
      contentType: "video/mp4",
      size: render?.bytes,
    });

    // The review screen sees a current video of the newest script: it can be approved.
    if (!reel) throw new Error("no reel");
    const { facts } = await reelReviewFacts(fx.ctx, reel);
    expect(facts).toMatchObject({ render: "READY", hasContent: true });
    const events = (await t.db.select().from(schema.auditEvents)).map((e) => e.action);
    expect(events).toEqual(
      expect.arrayContaining(["variant.generation_started", "variant.generated", "reel.attached"]),
    );
  });

  it("puts a new video on the Reel draft that exists, as its next script version", async () => {
    const first = await attachReelVideo(fx.ctx, {
      carouselVariantId: fx.carouselId,
      videoPath: clip("one.mp4"),
      script: SCRIPT,
    });
    const second = await attachReelVideo(fx.ctx, {
      carouselVariantId: fx.carouselId,
      videoPath: clip("two.mp4", "1080x1920", 12),
      script: { ...SCRIPT, post: undefined },
    });
    expect(second).toMatchObject({ variantId: first.variantId, created: false, scriptVersion: 2 });
    // 9 s of scenes against a 12 s video: a note, not a refusal.
    expect(second.warnings).toEqual([
      expect.stringContaining("The script's scenes last 9 s and the video 12 s."),
    ]);
    const [reel] = await reels();
    expect(reel).toMatchObject({
      status: "READY_FOR_REVIEW",
      currentReelRenderId: second.renderId,
    });
  });

  it("refuses to change the hook or redo a shot of an attached video", async () => {
    await fx.setEnabled(true);
    const { variantId } = await attachReelVideo(fx.ctx, {
      carouselVariantId: fx.carouselId,
      videoPath: clip("attached.mp4"),
      script: SCRIPT,
    });
    await expect(changeReelHook(fx.ctx, { variantId, hookId: "h2" })).rejects.toMatchObject({
      details: { code: "reel_attached" },
    });
    await expect(
      regenerateReelShot(fx.ctx, { variantId, sceneId: "s2", confirmEstimateUsd: 1 }),
    ).rejects.toMatchObject({ details: { code: "reel_attached" } });
  });

  it("refuses a file that is not a Reel, a script that does not fit, and an approved Reel", async () => {
    const square = clip("square.mp4", "1080x1080");
    await expect(
      attachReelVideo(fx.ctx, {
        carouselVariantId: fx.carouselId,
        videoPath: square,
        script: SCRIPT,
      }),
    ).rejects.toThrow(/1080×1080, it must be 1080×1920/);
    const ok = clip("fits.mp4");
    await expect(
      attachReelVideo(fx.ctx, {
        carouselVariantId: fx.carouselId,
        videoPath: ok,
        script: {
          ...SCRIPT,
          scenes: SCRIPT.scenes.map((s, i) => (i === 1 ? { ...s, claimSlideIds: ["c99"] } : s)),
        },
      }),
    ).rejects.toThrow(/Unknown slide ids: c99/);
    await expect(
      attachReelVideo(fx.ctx, {
        carouselVariantId: fx.carouselId,
        videoPath: ok,
        script: {
          ...SCRIPT,
          scenes: SCRIPT.scenes.map((s, i) => (i === 0 ? { ...s, card: "Otra cosa" } : s)),
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Nothing was made by the refused calls.
    expect(await reels()).toHaveLength(0);

    const { variantId } = await attachReelVideo(fx.ctx, {
      carouselVariantId: fx.carouselId,
      videoPath: ok,
      script: SCRIPT,
    });
    await t.db
      .update(schema.contentVariants)
      .set({ status: "APPROVED" })
      .where(eq(schema.contentVariants.id, variantId));
    await expect(
      attachReelVideo(fx.ctx, { carouselVariantId: fx.carouselId, videoPath: ok, script: SCRIPT }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });
});
