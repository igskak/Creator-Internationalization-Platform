import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { assetKeys, ImageDecodeError, normalizeImage, SLOT_PIXELS } from "./normalize";
import { hammingDistance, perceptualHash } from "./phash";

// Fixtures are made in memory with sharp; no files, no network.

/** A picture with structure: a bright block on a dark gradient, at a given position. */
const picture = async (width: number, height: number, blockLeft = 0.2) => {
  const base = sharp({ create: { width, height, channels: 3, background: "#202830" } });
  const block = await sharp({
    create: {
      width: Math.round(width / 4),
      height: Math.round(height / 4),
      channels: 3,
      background: "#f0e0a0",
    },
  })
    .png()
    .toBuffer();
  return base
    .composite([{ input: block, left: Math.round(width * blockLeft), top: Math.round(height / 3) }])
    .png()
    .toBuffer();
};

describe("normalizeImage", () => {
  it.each(Object.entries(SLOT_PIXELS))(
    "makes a %s slot image of exactly its pixels",
    async (aspect, size) => {
      const out = await normalizeImage(
        await picture(1024, 1536),
        aspect as keyof typeof SLOT_PIXELS,
      );
      expect(out).toMatchObject({ width: size.width, height: size.height, mimeType: "image/webp" });
      const meta = await sharp(out.bytes).metadata();
      expect(meta).toMatchObject({ format: "webp", width: size.width, height: size.height });
    },
  );

  it("is deterministic and gives a sha256 of the bytes", async () => {
    const input = await picture(800, 1200);
    const a = await normalizeImage(input, "4:5");
    const b = await normalizeImage(input, "4:5");
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("applies the EXIF orientation before cropping and leaves sRGB without a profile", async () => {
    // Stored 1200 wide × 800 tall with orientation 6 (rotate 90°): it is a 800 × 1200 portrait.
    const rotated = await sharp(await picture(1200, 800))
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await normalizeImage(rotated, "4:5");
    const meta = await sharp(out.bytes).metadata();
    expect(meta.space).toBe("srgb");
    expect(meta.icc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    // The portrait fills the 4:5 slot: the bright block (a tall one after rotation) is in the frame.
    const stats = await sharp(out.bytes).stats();
    expect(Math.max(...stats.channels.map((c) => c.max))).toBeGreaterThan(200);
  });

  it("converts a grey and an alpha image to three-channel sRGB", async () => {
    const grey = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#808080" },
    })
      .greyscale()
      .png()
      .toBuffer();
    expect((await sharp((await normalizeImage(grey, "1:1")).bytes).metadata()).space).toBe("srgb");
    const alpha = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    expect((await normalizeImage(alpha, "1:1")).width).toBe(1080);
  });

  it("crops towards the busy part instead of the middle", async () => {
    // A wide picture with the bright block on the far right; a 1:1 crop must still contain it.
    const wide = await picture(1600, 800, 0.72);
    const out = await normalizeImage(wide, "1:1");
    const { data } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    let bright = 0;
    for (let i = 0; i < data.length; i += 3) if ((data[i] ?? 0) > 200) bright++;
    expect(bright).toBeGreaterThan(1000);
  });

  it("throws an ImageDecodeError for bytes that are not an image", async () => {
    await expect(normalizeImage(new Uint8Array([1, 2, 3]), "1:1")).rejects.toBeInstanceOf(
      ImageDecodeError,
    );
  });
});

describe("perceptualHash", () => {
  it("is 16 hex characters and stable for the same pixels", async () => {
    const input = await picture(640, 800);
    const a = await perceptualHash(input);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await perceptualHash(input)).toBe(a);
  });

  it("stays close after a resize and a re-encode, and far from another picture", async () => {
    const original = await picture(1024, 1280);
    const small = await sharp(original).resize(300, 375).jpeg({ quality: 70 }).toBuffer();
    const other = await sharp({
      create: { width: 1024, height: 1280, channels: 3, background: "#000" },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 900, height: 100, channels: 3, background: "#fff" },
          })
            .png()
            .toBuffer(),
          left: 50,
          top: 900,
        },
      ])
      .png()
      .toBuffer();
    const h = await perceptualHash(original);
    expect(hammingDistance(h, await perceptualHash(small))).toBeLessThanOrEqual(6);
    expect(hammingDistance(h, await perceptualHash(other))).toBeGreaterThan(10);
  });

  it("counts differing bits", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("00000000000000ff", "0000000000000000")).toBe(8);
    expect(hammingDistance("abc0000000000001", "abc0000000000001")).toBe(0);
  });
});

describe("assetKeys", () => {
  it("follows the storage layout of 08 §8.8", () => {
    expect(
      assetKeys({
        variantId: "v1",
        slideId: "s1",
        slot: "hero",
        promptHash: "abc",
        originalMimeType: "image/png",
      }),
    ).toEqual({
      storageKey: "assets/v1/s1-hero-abc.webp",
      originalKey: "assets/v1/s1-hero-abc.orig.png",
    });
  });
});
