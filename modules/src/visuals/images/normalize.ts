import { createHash } from "node:crypto";
import sharp from "sharp";

// Image normalization (plan 08 §8.4, M3-04): auto-orient, convert to sRGB, crop to the slot's
// aspect around the busiest part of the picture (sharp's attention strategy), resize to the slot's
// pixels and encode WebP q90. The provider's original is kept by the caller next to the result.
// A cut-out on white (`fit: "contain"`, CV-01/CV-02) is padded with white instead of cropped: a
// 2:3 picture with a whole bowl at the top or bottom keeps the whole bowl, and the white margin
// disappears on the white slide.

export const SLOT_PIXELS = {
  "4:5": { width: 1080, height: 1350 },
  "3:4": { width: 1080, height: 1440 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1080, height: 608 },
  /** Half of the canvas (template C). */
  "8:5": { width: 1080, height: 675 },
} as const;
export type SlotAspect = keyof typeof SLOT_PIXELS;

export const WEBP_QUALITY = 90;

export type NormalizedImage = {
  bytes: Uint8Array;
  mimeType: "image/webp";
  width: number;
  height: number;
  sha256: string;
};

export class ImageDecodeError extends Error {
  constructor(cause: unknown) {
    super("The image could not be read.", { cause });
    this.name = "ImageDecodeError";
  }
}

export async function normalizeImage(
  input: Uint8Array,
  aspect: SlotAspect,
  options: { fit?: "cover" | "contain" } = {},
): Promise<NormalizedImage> {
  const { width, height } = SLOT_PIXELS[aspect];
  try {
    const oriented = sharp(input, { failOn: "error" })
      .rotate() // auto-orient from EXIF and drop the tag
      .toColourspace("srgb");
    const sized =
      options.fit === "contain"
        ? oriented
            .flatten({ background: "#ffffff" })
            .resize(width, height, { fit: "contain", background: "#ffffff" })
        : oriented.resize(width, height, { fit: "cover", position: sharp.strategy.attention });
    const { data, info } = await sized
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      bytes: new Uint8Array(data),
      mimeType: "image/webp",
      width: info.width,
      height: info.height,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  } catch (error) {
    throw new ImageDecodeError(error);
  }
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Storage keys of a generated image (08 §8.8): the normalized one and the provider's original. */
export function assetKeys(args: {
  variantId: string;
  slideId: string;
  slot: string;
  promptHash: string;
  originalMimeType: string;
}): { storageKey: string; originalKey: string } {
  const base = `assets/${args.variantId}/${args.slideId}-${args.slot}-${args.promptHash}`;
  return {
    storageKey: `${base}.webp`,
    originalKey: `${base}.orig.${EXTENSIONS[args.originalMimeType] ?? "bin"}`,
  };
}
