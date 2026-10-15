import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultExec } from "../render/exec";
import { createE2eVideo } from "./e2e-video";

// The E2E video provider: real, playable clips, a different one per shot. Needs ffmpeg and ffprobe
// (skipped where they are missing, like the other tests that run ffmpeg).

const haveFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!haveFfmpeg)("createE2eVideo", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "e2e-video-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const request = (key: string) => ({
    prompt: "Static camera. Steam rises.",
    image: { bytes: new Uint8Array([1]), mimeType: "image/png" as const },
    durationSeconds: 3,
    idempotencyKey: key,
  });

  it("returns a playable portrait clip for a shot", async () => {
    const video = createE2eVideo({ dir });
    const shot = await video.generate(request("shot-a"));
    expect(shot.mimeType).toBe("video/mp4");
    expect(shot.costUsd).toBeGreaterThan(0);
    const file = join(dir, "probe.mp4");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, shot.bytes);
    const { stdout } = await defaultExec("ffprobe", [
      ...["-v", "error", "-select_streams", "v:0"],
      ...["-show_entries", "stream=codec_name,width,height,duration", "-of", "csv=p=0", file],
    ]);
    const [codec, width, height, seconds] = stdout.trim().split(",");
    expect([codec, width, height]).toEqual(["h264", "720", "1280"]);
    expect(Number(seconds)).toBeGreaterThanOrEqual(3.9);
  });

  it("makes each shot look different and a repeated shot the same", async () => {
    const video = createE2eVideo({ dir });
    const [a, b] = await Promise.all([
      video.generate(request("shot-a")),
      video.generate(request("shot-b")),
    ]);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(false);
    const again = await createE2eVideo({ dir }).generate(request("shot-a"));
    expect(Buffer.from(again.bytes).equals(Buffer.from(a.bytes))).toBe(true);
  });
});
