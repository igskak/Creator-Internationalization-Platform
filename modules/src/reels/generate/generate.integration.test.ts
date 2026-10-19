import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb } from "@rc/db/test-db";
import type { GeneratedShot, ShotHandle, VideoProvider } from "@rc/lib/providers/video";
import type { Browser } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { launchBrowser } from "../../visuals/render";
import { generateReel } from "./generate";
import { reelFixture } from "./test-support";

// The whole job with real ffmpeg and a real Chromium for the cards; only the model, the image model
// and the video vendor are fakes (the vendor returns a real 4 s clip with a tone, one scene's clip
// without sound). Skipped without ffmpeg or a browser.

const haveFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const browser: Browser | undefined = await launchBrowser().catch(() => undefined);
const tmp = mkdtempSync(join(tmpdir(), "reel-it-"));
afterAll(async () => {
  await browser?.close();
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * A vendor that returns a real clip: a grey-cast background with a moving square, 720 × 1280, and
 * the model's sound (a tone); the clip of scene s3 has no sound, as a refused or silent shot may not.
 */
function clipVendor(): VideoProvider {
  const make = (path: string, withSound: boolean) =>
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0xe6e6e6:s=720x1280:r=30:d=4",
      "-f",
      "lavfi",
      "-i",
      "color=c=0xd2402d:s=240x240:r=30:d=4",
      ...(withSound
        ? ["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100:duration=4"]
        : []),
      "-filter_complex",
      "[0:v][1:v]overlay=x='60+120*t':y=520,format=yuv420p[v]",
      "-map",
      "[v]",
      ...(withSound ? ["-map", "2:a", "-c:a", "aac"] : []),
      "-c:v",
      "libx264",
      "-t",
      "4",
      path,
    ]);
  const loud = join(tmp, "clip.mp4");
  const silent = join(tmp, "clip-silent.mp4");
  make(loud, true);
  make(silent, false);
  const clipOf = (requestId: string) => (requestId.endsWith("-s3") ? silent : loud);
  let n = 0;
  return {
    id: "fake",
    model: "alibaba/wan-3.0",
    submit: async (request): Promise<ShotHandle> => ({
      requestId: `clip-${++n}-${request.label ?? ""}`,
      model: request.model ?? "alibaba/wan-3.0",
      durationSeconds: request.durationSeconds,
      resolution: request.resolution ?? "720p",
    }),
    waitFor: async (handle): Promise<GeneratedShot> => ({
      bytes: new Uint8Array(readFileSync(clipOf(handle.requestId))),
      mimeType: "video/mp4",
      width: 720,
      height: 1280,
      durationSeconds: handle.durationSeconds,
      model: handle.model,
      providerRequestId: handle.requestId,
      costUsd: 0.3,
      params: {},
    }),
    generate: async (request) => {
      const handle = await clipVendor().submit(request);
      return clipVendor().waitFor(handle);
    },
  };
}

describe.skipIf(!haveFfmpeg || !browser)("generateReel with ffmpeg and Chromium", () => {
  it("turns the synthetic script into a real, clean mp4 in storage", async () => {
    const t = await createTestDb();
    try {
      await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
      const fx = await reelFixture(t.db);
      await fx.setEnabled(true);
      const [carousel] = await t.db
        .select()
        .from(schema.contentVariants)
        .where(eq(schema.contentVariants.id, fx.carouselId));
      const [reel] = await t.db
        .insert(schema.contentVariants)
        .values({
          masterIdeaId: carousel?.masterIdeaId ?? "",
          marketId: carousel?.marketId ?? "",
          format: "REEL",
          status: "DRAFT",
          sourceVariantId: fx.carouselId,
        })
        .returning();

      const result = await generateReel(
        fx.jobCtx({ video: clipVendor() }),
        { variantId: reel?.id ?? "", requestId: "r1" },
        { assembleOptions: { browser: browser as Browser, crf: 23, preset: "ultrafast" } },
      );
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ status: "READY", shots: { total: 6, reused: 0 } });
      expect(result.qaWarnings).toEqual([]);

      const [render] = await t.db.select().from(schema.reelRenders);
      expect(render).toMatchObject({
        status: "READY",
        width: 1080,
        height: 1920,
        audioKind: "MODEL_AUDIO",
      });
      expect(render?.qaReport).toMatchObject({
        videoCodec: "h264",
        audioCodec: "aac",
        safeZoneOk: true,
        blackFrames: 0,
      });
      // 6 scenes: 7 (the hook, held) + 6 + 6 + 6 + 6 + 7 beats = 19 s, no flash opener.
      expect(Math.abs((render?.durationMs ?? 0) - 19_000)).toBeLessThan(150);
      const info = await fx.storage.head(render?.storageKey ?? "");
      expect(info?.contentType).toBe("video/mp4");
      expect(info?.size).toBe(render?.bytes);
      const bytes = await fx.storage.getBytes(render?.storageKey ?? "");
      expect(Buffer.from(bytes.slice(4, 8)).toString("latin1")).toBe("ftyp");
    } finally {
      await t.close();
    }
  }, 240_000);
});
