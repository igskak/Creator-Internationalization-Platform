import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import { and, eq, inArray } from "@rc/db/orm";
import { TransientError } from "@rc/lib/errors";
import type { ServiceContext } from "../../core";

// Start pictures made for a Reel's shots (reel-director@4, docs/design/reel-style.md "Pictures"):
// the director describes each shot's first frame, the system adds the account's look and the image
// model draws it. A frame is a `visual_assets` row (slot `reel-frame`, slide id = scene id) found
// again by the brand and the hash of its prompt, so a rerun, a redone shot and the other market's
// Reel never pay for the same picture twice. The PNG goes to storage as it came.

/** The `visual_assets.slot` of a Reel frame. */
export const REEL_FRAME_SLOT = "reel-frame";
/** The image size the frame is drawn at: portrait, cut to 9:16 for the shot. */
export const REEL_FRAME_ASPECT = "3:4" as const;
/** List price of one high-quality portrait image (measured about 0.042 USD, M3-15), rounded up. */
export const REEL_FRAME_COST_USD = 0.05;

/**
 * The account's look (owner's pick of 2026-10-19, variant A of the rice test): white seamless page,
 * high-key light, macro, the subject low with the top free for the card. Pale food in dark cookware
 * is the owner's rule, repeated here in case a frame prompt forgets it.
 */
export const REEL_FRAME_STYLE =
  "Vertical high-key studio food photograph on a pure white seamless background (#FFFFFF), minimalist look, soft diffused even light, macro detail, photorealistic. Pale or white food sits in dark cookware (black cast iron, dark enamel, charcoal ceramic) so it stands out on the white page. The subject sits in the lower 60% of the frame; the top 40% is clean empty white. No people, no hands, no text, no labels, no logos, no props, no table texture.";

export const reelFramePrompt = (framePrompt: string) => `${framePrompt.trim()} ${REEL_FRAME_STYLE}`;

/** Same picture description, same model → same hash → the same frame. */
export const reelFrameHash = (prompt: string, model: string): string =>
  createHash("sha256")
    .update(JSON.stringify([prompt, REEL_FRAME_ASPECT, model]))
    .digest("hex")
    .slice(0, 16);

export type ReelFrame = {
  /** `visual_assets.id`; the shot records it as the picture it starts from. */
  assetId: string;
  bytes: Uint8Array;
  costUsd: number | null;
  /** True when a READY frame of the same hash already existed (this run did not pay). */
  reused: boolean;
};

type FrameContext = { brandId: string; variantId: string };

/**
 * The frame of one scene: an existing READY one of the brand, or a new picture. Returns null when
 * the image model refused or failed for good, so the shot falls back to the carousel picture; a
 * transient failure is thrown for the job to retry.
 */
export async function ensureReelFrame(
  ctx: ServiceContext,
  frameCtx: FrameContext,
  scene: { id: string; framePrompt: string },
): Promise<ReelFrame | null> {
  const prompt = reelFramePrompt(scene.framePrompt);
  const promptHash = reelFrameHash(prompt, ctx.images.model);
  const ready = async () => {
    const [row] = await ctx.db
      .select()
      .from(schema.visualAssets)
      .where(
        and(
          eq(schema.visualAssets.brandId, frameCtx.brandId),
          eq(schema.visualAssets.slot, REEL_FRAME_SLOT),
          eq(schema.visualAssets.promptHash, promptHash),
          eq(schema.visualAssets.kind, "GENERATED"),
          eq(schema.visualAssets.status, "READY"),
        ),
      )
      .limit(1);
    return row;
  };
  const existing = await ready();
  if (existing?.storageKey) {
    return {
      assetId: existing.id,
      bytes: await ctx.storage.getBytes(existing.storageKey),
      costUsd: null,
      reused: true,
    };
  }

  // The row first: a concurrent run of this Reel finds it through the unique index.
  const [claimed] = await ctx.db
    .insert(schema.visualAssets)
    .values({
      brandId: frameCtx.brandId,
      kind: "GENERATED",
      status: "PENDING",
      contentVariantId: frameCtx.variantId,
      slideId: scene.id,
      slot: REEL_FRAME_SLOT,
      provider: ctx.images.id,
      model: ctx.images.model,
      prompt,
      promptHash,
      isAiGenerated: true,
    })
    .onConflictDoNothing()
    .returning({ id: schema.visualAssets.id });
  if (!claimed) {
    throw new TransientError("The frame is being made by another run.", {
      details: { code: "frame_in_progress", sceneId: scene.id },
    });
  }

  try {
    const image = await ctx.images.generate({
      prompt,
      aspect: REEL_FRAME_ASPECT,
      label: `reel-frame/${scene.id}`,
    });
    const extension = image.mimeType === "image/png" ? "png" : image.mimeType.split("/")[1];
    const key = `reels/frames/${frameCtx.brandId}/${promptHash}.${extension}`;
    await ctx.storage.put(key, image.bytes, { contentType: image.mimeType });
    await ctx.db
      .update(schema.visualAssets)
      .set({
        status: "READY",
        storageKey: key,
        originalKey: key,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        bytes: image.bytes.byteLength,
        params: { ...image.params, costUsd: image.costUsd },
        error: null,
      })
      .where(eq(schema.visualAssets.id, claimed.id));
    return { assetId: claimed.id, bytes: image.bytes, costUsd: image.costUsd, reused: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.db
      .update(schema.visualAssets)
      .set({ status: "FAILED", error: { code: "GENERATION_FAILED", message } })
      .where(eq(schema.visualAssets.id, claimed.id));
    if (error instanceof TransientError) throw error;
    ctx.logger.warn(
      { sceneId: scene.id, error: message },
      "reel frame failed; the shot starts from the carousel picture",
    );
    return null;
  }
}

/** Frames of a Reel variant that are still PENDING (a crashed run); cleared before a new attempt. */
export async function clearPendingReelFrames(
  ctx: ServiceContext,
  variantId: string,
  sceneIds: readonly string[],
): Promise<void> {
  if (sceneIds.length === 0) return;
  await ctx.db
    .update(schema.visualAssets)
    .set({ status: "FAILED", error: { code: "ABANDONED", message: "The run stopped." } })
    .where(
      and(
        eq(schema.visualAssets.contentVariantId, variantId),
        eq(schema.visualAssets.slot, REEL_FRAME_SLOT),
        eq(schema.visualAssets.status, "PENDING"),
        inArray(schema.visualAssets.slideId, [...sceneIds]),
      ),
    );
}
