import pixelmatch from "pixelmatch";
import sharp from "sharp";

// Image comparison for the visual regression tests (plan 08 §8.9, M3-14): pixelmatch with a
// per-pixel threshold of 0.1; a render fails when more than 0.1 % of its pixels differ.

export const PIXEL_THRESHOLD = 0.1;
export const MAX_DIFF_RATIO = 0.001;

export type Comparison = {
  width: number;
  height: number;
  diffPixels: number;
  ratio: number;
  ok: boolean;
  /** PNG with the differing pixels in red; undefined when the sizes differ. */
  diffPng?: Uint8Array;
};

async function decode(png: Uint8Array) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function comparePng(actual: Uint8Array, golden: Uint8Array): Promise<Comparison> {
  const [a, g] = await Promise.all([decode(actual), decode(golden)]);
  if (a.width !== g.width || a.height !== g.height) {
    return {
      width: a.width,
      height: a.height,
      diffPixels: a.width * a.height,
      ratio: 1,
      ok: false,
    };
  }
  const diff = Buffer.alloc(a.width * a.height * 4);
  const diffPixels = pixelmatch(a.data, g.data, diff, a.width, a.height, {
    threshold: PIXEL_THRESHOLD,
  });
  const ratio = diffPixels / (a.width * a.height);
  const diffPng = await sharp(diff, { raw: { width: a.width, height: a.height, channels: 4 } })
    .png()
    .toBuffer();
  return {
    width: a.width,
    height: a.height,
    diffPixels,
    ratio,
    ok: ratio <= MAX_DIFF_RATIO,
    diffPng: new Uint8Array(diffPng),
  };
}
