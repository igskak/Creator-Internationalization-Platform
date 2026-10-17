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
});
