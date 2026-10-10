import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { comparePng, MAX_DIFF_RATIO } from "./golden";

const png = (
  color: string,
  width = 100,
  height = 100,
  patch?: { left: number; top: number; size: number; color: string },
) => {
  const base = sharp({ create: { width, height, channels: 3, background: color } });
  const out = patch
    ? base.composite([
        {
          input: {
            create: { width: patch.size, height: patch.size, channels: 3, background: patch.color },
          },
          left: patch.left,
          top: patch.top,
        },
      ])
    : base;
  return out.png().toBuffer();
};

describe("comparePng", () => {
  it("accepts identical images", async () => {
    const a = await png("#336699");
    expect(await comparePng(a, a)).toMatchObject({ diffPixels: 0, ratio: 0, ok: true });
  });

  it("accepts a difference below the limit and rejects one above it", async () => {
    const base = await png("#336699", 100, 100);
    // 3 × 3 = 9 pixels of 10,000 = 0.09 %: inside the 0.1 % limit.
    const tiny = await png("#336699", 100, 100, { left: 10, top: 10, size: 3, color: "#ff0000" });
    const small = await comparePng(tiny, base);
    expect(small).toMatchObject({ diffPixels: 9, ok: true });
    // 4 × 4 = 16 pixels = 0.16 %.
    const more = await png("#336699", 100, 100, { left: 10, top: 10, size: 4, color: "#ff0000" });
    const big = await comparePng(more, base);
    expect(big.ratio).toBeGreaterThan(MAX_DIFF_RATIO);
    expect(big.ok).toBe(false);
    expect(big.diffPng).toBeDefined();
  });

  it("ignores a colour difference too small to see (threshold 0.1)", async () => {
    expect((await comparePng(await png("#336699"), await png("#336798"))).ok).toBe(true);
  });

  it("fails images of different sizes", async () => {
    expect(
      await comparePng(await png("#000", 100, 100), await png("#000", 100, 101)),
    ).toMatchObject({
      ok: false,
      ratio: 1,
    });
  });
});
