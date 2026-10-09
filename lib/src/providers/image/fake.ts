import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import type { GeneratedImage, ImageAspect, ImageProvider, ImageRequest } from "./types";

// FakeImageProvider (M3-03): a small deterministic gradient PNG whose colors come from a hash of
// the prompt, with the slot label stored in a `tEXt` chunk. No network, no cost.

const SIZES: Record<ImageAspect, [number, number]> = {
  "4:5": [256, 320],
  "1:1": [256, 256],
  "3:4": [240, 320],
  "16:9": [320, 180],
};

const chunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
  return out;
};

export function gradientPng(width: number, height: number, seed: string, label = ""): Uint8Array {
  const h = createHash("sha256").update(seed).digest();
  const from = [h[0] ?? 0, h[1] ?? 0, h[2] ?? 0];
  const to = [h[3] ?? 0, h[4] ?? 0, h[5] ?? 0];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      for (let c = 0; c < 3; c++) {
        raw[row + 1 + x * 3 + c] = Math.round((from[c] ?? 0) * (1 - t) + (to[c] ?? 0) * t);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("tEXt", Buffer.from(`label\0${label}`, "latin1")),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

export type FakeImageOptions = {
  /** Make a call fail, e.g. to test a per-slot failure. */
  fail?: (request: ImageRequest, call: number) => Error | undefined;
};

export function createFakeImageProvider(
  options: FakeImageOptions = {},
): ImageProvider & { readonly calls: ImageRequest[] } {
  const calls: ImageRequest[] = [];
  return {
    id: "fake",
    model: "fake-image",
    calls,
    async generate(request): Promise<GeneratedImage> {
      calls.push(request);
      const error = options.fail?.(request, calls.length);
      if (error) throw error;
      const [width, height] = SIZES[request.aspect];
      return {
        bytes: gradientPng(width, height, request.prompt, request.label),
        mimeType: "image/png",
        width,
        height,
        model: "fake-image",
        costUsd: 0,
        params: { aspect: request.aspect },
      };
    },
  };
}
