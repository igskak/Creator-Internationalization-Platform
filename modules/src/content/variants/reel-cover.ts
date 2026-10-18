import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import { and, eq } from "@rc/db/orm";
import sharp from "sharp";
import type { ServiceContext } from "../../core";

// The Reel's grid cover (carousel v3, R3; Meta's IG User Media reference, `cover_url`, read
// 2026-10-17: a JPEG of at most 8 MB, sRGB, 9:16 recommended, otherwise Meta crops the middle 9:16
// rectangle). Without one Instagram takes the video's first frame, so the grid showed a bare pot.
// The cover is the source carousel's own cover slide, as rendered, placed in a 1080 × 1920 frame
// whose bands above and below take the slide's top and bottom edge colours: a white cover gets
// white bands, a dark one dark bands, and the grid's 3:4 crop shows the whole slide.

export const REEL_COVER = { width: 1080, height: 1920 } as const;
const MAX_COVER_BYTES = 8 * 1024 * 1024;

/** Mean colour of a band of rows of a raw RGB(A) image. */
function bandColour(
  image: { data: Uint8Array; width: number; channels: number },
  fromRow: number,
  rows: number,
): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = fromRow; y < fromRow + rows; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * image.channels;
      r += image.data[i] ?? 0;
      g += image.data[i + 1] ?? 0;
      b += image.data[i + 2] ?? 0;
      n++;
    }
  }
  return n
    ? { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
    : { r: 255, g: 255, b: 255 };
}

/** A 1080 × 1920 JPEG of a slide, centred, with bands in its own top and bottom edge colours. */
export async function reelCoverFromSlide(slide: Uint8Array): Promise<Uint8Array> {
  const { width, height } = REEL_COVER;
  const body = await sharp(slide).resize(width, null).removeAlpha().toColourspace("srgb");
  const { data, info } = await body.clone().raw().toBuffer({ resolveWithObject: true });
  const slideHeight = Math.min(info.height, height);
  const top = Math.floor((height - slideHeight) / 2);
  const edge = Math.max(1, Math.round(info.height * 0.02));
  const above = bandColour({ data, width: info.width, channels: info.channels }, 0, edge);
  const below = bandColour(
    { data, width: info.width, channels: info.channels },
    info.height - edge,
    edge,
  );
  const band = (h: number, c: { r: number; g: number; b: number }) =>
    sharp({ create: { width, height: h, channels: 3, background: c } })
      .png()
      .toBuffer();
  const slidePng = await body.png().toBuffer();
  const cover = await sharp({
    create: { width, height, channels: 3, background: above },
  })
    .composite([
      { input: slidePng, left: 0, top },
      { input: await band(height - top - slideHeight, below), left: 0, top: top + slideHeight },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
  return new Uint8Array(cover);
}

export type ReelCover = { key: string; sha256: string; bytes: number };

/**
 * Makes and stores the cover of a Reel from its source carousel's current render (its first
 * slide). Null when there is nothing to make it from or anything fails: a Reel is published with
 * its first frame then, as before, so the cover never blocks an approval.
 */
export async function prepareReelCover(
  ctx: ServiceContext,
  input: { variantId: string; sourceVariantId: string | null; reelRenderId: string },
): Promise<ReelCover | null> {
  if (!input.sourceVariantId) return null;
  try {
    const [source] = await ctx.db
      .select({ renderId: schema.contentVariants.currentRenderId })
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, input.sourceVariantId));
    if (!source?.renderId) return null;
    const [first] = await ctx.db
      .select({ storageKey: schema.renderedSlides.storageKey })
      .from(schema.renderedSlides)
      .where(
        and(
          eq(schema.renderedSlides.carouselRenderId, source.renderId),
          eq(schema.renderedSlides.slideIndex, 0),
        ),
      );
    if (!first) return null;
    const cover = await reelCoverFromSlide(await ctx.storage.getBytes(first.storageKey));
    if (cover.byteLength > MAX_COVER_BYTES) return null;
    const sha256 = createHash("sha256").update(cover).digest("hex");
    const key = `renders/reels/${input.variantId}/cover-${input.reelRenderId}-${sha256.slice(0, 16)}.jpg`;
    await ctx.storage.put(key, cover, { contentType: "image/jpeg" });
    return { key, sha256, bytes: cover.byteLength };
  } catch (error) {
    ctx.logger.warn(
      { err: error, variantId: input.variantId },
      "The Reel's cover could not be made; Instagram will use the first frame.",
    );
    return null;
  }
}
