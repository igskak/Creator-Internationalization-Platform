import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { REEL_COVER, reelCoverFromSlide } from "./reel-cover";

// Synthetic images only.

/** A 1080 × 1350 slide: a white top half and a dark bottom half. */
async function slide(top: string, bottom: string): Promise<Uint8Array> {
  const half = (c: string) =>
    sharp({ create: { width: 1080, height: 675, channels: 3, background: c } })
      .png()
      .toBuffer();
  return new Uint8Array(
    await sharp({ create: { width: 1080, height: 1350, channels: 3, background: top } })
      .composite([{ input: await half(bottom), left: 0, top: 675 }])
      .jpeg()
      .toBuffer(),
  );
}

const pixel = async (jpeg: Uint8Array, x: number, y: number) => {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
};

describe("reelCoverFromSlide", () => {
  it("puts the slide in a 9:16 JPEG with bands in its own edge colours", async () => {
    const cover = await reelCoverFromSlide(await slide("#ffffff", "#202020"));
    const meta = await sharp(cover).metadata();
    expect(meta).toMatchObject({
      format: "jpeg",
      width: REEL_COVER.width,
      height: REEL_COVER.height,
    });
    // The band above takes the white top edge, the band below the dark bottom edge.
    expect((await pixel(cover, 540, 40)).every((v) => v > 245)).toBe(true);
    expect((await pixel(cover, 540, 1880)).every((v) => v < 50)).toBe(true);
    // The slide sits in the middle: its own halves at their places.
    expect((await pixel(cover, 540, 400)).every((v) => v > 245)).toBe(true);
    expect((await pixel(cover, 540, 1500)).every((v) => v < 50)).toBe(true);
  });

  it("keeps the whole slide inside the profile grid's 3:4 crop (G-10)", async () => {
    // The grid shows the middle 1080 × 1440 of the 9:16 cover: rows 240 to 1680.
    const crop = { top: (REEL_COVER.height - 1440) / 2, bottom: (REEL_COVER.height + 1440) / 2 };
    // A white slide with blue marks 30 px inside its top and bottom edges (the safe margin is 72).
    const mark = await sharp({
      create: { width: 1080, height: 20, channels: 3, background: "#0000ff" },
    })
      .png()
      .toBuffer();
    const marked = new Uint8Array(
      await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#ffffff" } })
        .composite([
          { input: mark, left: 0, top: 30 },
          { input: mark, left: 0, top: 1300 },
        ])
        .png()
        .toBuffer(),
    );
    const cover = await reelCoverFromSlide(marked);
    const slideTop = (REEL_COVER.height - 1350) / 2;
    for (const y of [slideTop + 40, slideTop + 1310]) {
      expect(y).toBeGreaterThanOrEqual(crop.top);
      expect(y).toBeLessThan(crop.bottom);
      const [r = 0, g = 0, b = 0] = await pixel(cover, 540, y);
      expect(b).toBeGreaterThan(200);
      expect(r + g).toBeLessThan(80);
    }
  });
});
