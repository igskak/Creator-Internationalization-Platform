import { createHash } from "node:crypto";
import { estimateShotCostUsd, PORTRAIT_SIZES } from "./rates";
import {
  type AwaitOptions,
  DEFAULT_VIDEO_MODEL,
  type GeneratedShot,
  type ShotHandle,
  type ShotRequest,
  type VideoProvider,
} from "./types";

// FakeVideoProvider (M8-02): a tiny deterministic mp4-shaped file whose bytes depend on the shot's
// idempotency key and prompt. It starts with an `ftyp` box like a real mp4 but is not playable.
// No network, no cost.

/** A minimal `ftyp` box, then a `free` box that carries the seed so two shots differ. */
export function fakeMp4(seed: string, label = ""): Uint8Array {
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
    0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
  ]);
  const payload = Buffer.from(
    `${createHash("sha256").update(seed).digest("hex")}:${label}`,
    "latin1",
  );
  const free = Buffer.alloc(8 + payload.length);
  free.writeUInt32BE(free.length, 0);
  free.write("free", 4, "ascii");
  payload.copy(free, 8);
  return new Uint8Array(Buffer.concat([ftyp, free]));
}

export type FakeVideoOptions = {
  /** Make a call fail, e.g. to test a per-shot failure. `call` counts submissions from 1. */
  fail?: (request: ShotRequest, call: number) => Error | undefined;
};

export function createFakeVideoProvider(
  options: FakeVideoOptions = {},
): VideoProvider & { readonly calls: ShotRequest[] } {
  const calls: ShotRequest[] = [];
  const seeds = new Map<string, { seed: string; label: string }>();
  const requestIdFor = (key: string) =>
    `fake-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;

  const provider: VideoProvider & { readonly calls: ShotRequest[] } = {
    id: "fake",
    model: DEFAULT_VIDEO_MODEL,
    calls,
    async submit(request): Promise<ShotHandle> {
      const model = request.model ?? DEFAULT_VIDEO_MODEL;
      const error = options.fail?.(request, calls.length + 1);
      calls.push(request);
      if (error) throw error;
      const requestId = requestIdFor(request.idempotencyKey);
      seeds.set(requestId, {
        seed: `${request.idempotencyKey}|${request.prompt}`,
        label: request.label ?? "",
      });
      return {
        requestId,
        model,
        durationSeconds: request.durationSeconds,
        resolution: request.resolution ?? "720p",
      };
    },
    async waitFor(handle, _options?: AwaitOptions): Promise<GeneratedShot> {
      const known = seeds.get(handle.requestId) ?? { seed: handle.requestId, label: "" };
      const { width, height } = PORTRAIT_SIZES[handle.resolution];
      return {
        bytes: fakeMp4(known.seed, known.label),
        mimeType: "video/mp4",
        width,
        height,
        durationSeconds: handle.durationSeconds,
        model: handle.model,
        providerRequestId: handle.requestId,
        costUsd: estimateShotCostUsd(handle.model, handle.durationSeconds, handle.resolution),
        params: {
          model: handle.model,
          durationSeconds: handle.durationSeconds,
          resolution: handle.resolution,
        },
      };
    },
    async generate(request, wait) {
      return provider.waitFor(await provider.submit(request), wait);
    },
  };
  return provider;
}
