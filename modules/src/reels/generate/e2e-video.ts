import { createHash } from "node:crypto";
import { mkdir, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeVideoProvider, type VideoProvider } from "@rc/lib/providers/video";
import { defaultExec, type Exec } from "../render/exec";

// The video provider of the E2E server (M8-07a): the fake provider, but every shot is a real, small
// mp4 (a test pattern at 720 × 1280, 4 s, a colour of its own per shot) so that the real assembly
// (ffmpeg and the card renderer) can build a playable Reel from it. Made with ffmpeg on first use
// and kept in the temp folder. No network, no cost. Only the web runtime uses it, and only when
// E2E_TEST_AUTH_SECRET is set (which production refuses).

const CLIP_SECONDS = 4;

export function createE2eVideo(options: { exec?: Exec; dir?: string } = {}): VideoProvider {
  const exec = options.exec ?? defaultExec;
  const dir = options.dir ?? join(tmpdir(), "rc-e2e-clips");
  const fake = createFakeVideoProvider();
  const made = new Map<string, Promise<Uint8Array>>();

  /** The clip for a request id: its hue comes from the id, so two shots look different. */
  const clip = (requestId: string): Promise<Uint8Array> => {
    const key = createHash("sha256").update(requestId).digest("hex").slice(0, 16);
    let pending = made.get(key);
    if (!pending) {
      pending = (async () => {
        await mkdir(dir, { recursive: true });
        const file = join(dir, `${key}.mp4`);
        try {
          return new Uint8Array(await readFile(file));
        } catch {
          // Not made yet.
        }
        const hue = Number.parseInt(key.slice(0, 4), 16) % 360;
        const partial = join(dir, `${key}.${process.pid}.part.mp4`);
        await exec("ffmpeg", [
          ...["-hide_banner", "-loglevel", "error", "-y"],
          ...["-f", "lavfi", "-i", `testsrc2=size=720x1280:rate=30:duration=${CLIP_SECONDS}`],
          ...["-vf", `hue=h=${hue}`],
          ...["-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-an"],
          ...["-movflags", "+faststart", partial],
        ]);
        await rename(partial, file);
        return new Uint8Array(await readFile(file));
      })();
      made.set(key, pending);
    }
    return pending;
  };

  const provider: VideoProvider = {
    id: "fake",
    model: fake.model,
    submit: (request) => fake.submit(request),
    async waitFor(handle, wait) {
      const shot = await fake.waitFor(handle, wait);
      return { ...shot, bytes: await clip(handle.requestId) };
    },
    async generate(request, wait) {
      return provider.waitFor(await provider.submit(request), wait);
    },
  };
  return provider;
}
