import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import { and, eq, ne } from "@rc/db/orm";
import { InvalidStateError, ValidationError } from "@rc/lib/errors";
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS } from "@rc/lib/providers/video";
import { z } from "zod";
import { audit, type ServiceContext, triggerJob } from "../../core";
import { assertReelsEnabled, reelsEnabled } from "./enabled";
import { estimateReel, type ReelEstimate } from "./estimate";
import { loadReelSource } from "./source";

// The two services behind the Generate Reel button (plan 18 §18.6, decisions RL-2 and RL-4):
// `estimateReelCost` says what a Reel would cost, `requestReel` starts it, only after the owner
// confirmed an estimate. Nothing is spent before: a draft never makes a Reel.

/** A confirmed estimate may be a cent or two below the current one (rounding, a rate change). */
const CONFIRM_SLACK_USD = 0.02;
const REUSABLE: readonly string[] = ["DRAFT", "READY_FOR_REVIEW", "CHANGES_REQUESTED"];

export const EstimateReelInput = z.object({
  carouselVariantId: z.uuid(),
  model: z.enum(VIDEO_MODELS).optional(),
});

export type ReelEstimateView = {
  estimate: ReelEstimate;
  /** The kill switch of Settings. */
  enabled: boolean;
  /** Why the button is off (a stable code), or null. */
  blockedBy: "reels_disabled" | "reel_generating" | "reel_in_use" | null;
  /** The Reel variant of this idea and market, if one exists. */
  reelVariantId: string | null;
};

async function findReel(ctx: ServiceContext, masterIdeaId: string, marketId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(
      and(
        eq(schema.contentVariants.masterIdeaId, masterIdeaId),
        eq(schema.contentVariants.marketId, marketId),
        eq(schema.contentVariants.format, "REEL"),
        ne(schema.contentVariants.status, "REJECTED"),
      ),
    );
  return row;
}

export async function estimateReelCost(
  ctx: ServiceContext,
  raw: z.input<typeof EstimateReelInput>,
): Promise<ReelEstimateView> {
  const input = EstimateReelInput.parse(raw);
  const source = await loadReelSource(ctx, input.carouselVariantId);
  const estimate = estimateReel({ model: input.model ?? DEFAULT_VIDEO_MODEL });
  const enabled = await reelsEnabled(ctx);
  const reel = await findReel(ctx, source.idea.id, source.market.id);
  const blockedBy = !enabled
    ? "reels_disabled"
    : reel?.status === "GENERATING"
      ? "reel_generating"
      : reel && !REUSABLE.includes(reel.status)
        ? "reel_in_use"
        : null;
  return { estimate, enabled, blockedBy, reelVariantId: reel?.id ?? null };
}

export const RequestReelInput = EstimateReelInput.extend({
  hookId: z.string().min(1).optional(),
  /** The estimate the owner saw and accepted, in USD. */
  confirmEstimateUsd: z.number().nonnegative(),
});

export type RequestedReel = { variantId: string; runId: string; estimate: ReelEstimate };

export async function requestReel(
  ctx: ServiceContext,
  raw: z.input<typeof RequestReelInput>,
): Promise<RequestedReel> {
  const input = RequestReelInput.parse(raw);
  await assertReelsEnabled(ctx);
  const source = await loadReelSource(ctx, input.carouselVariantId);
  const { carousel } = source;
  const model = input.model ?? DEFAULT_VIDEO_MODEL;
  const estimate = estimateReel({ model });
  if (input.confirmEstimateUsd + CONFIRM_SLACK_USD < estimate.totalUsd) {
    throw new ValidationError(
      `The estimate is now about $${estimate.totalUsd.toFixed(2)}, not $${input.confirmEstimateUsd.toFixed(2)}. Confirm the new amount.`,
      { details: { code: "estimate_changed", estimateUsd: estimate.totalUsd } },
    );
  }

  let reel = await findReel(ctx, source.idea.id, source.market.id);
  if (reel?.status === "GENERATING") {
    throw new InvalidStateError("A Reel is already being made for this post.", {
      details: { code: "reel_generating", variantId: reel.id },
    });
  }
  if (reel && !REUSABLE.includes(reel.status)) {
    throw new InvalidStateError(
      `A ${reel.status} Reel is not generated again. Un-approve it first.`,
      {
        details: { code: "reel_in_use", variantId: reel.id, status: reel.status },
      },
    );
  }
  if (!reel) {
    [reel] = await ctx.db
      .insert(schema.contentVariants)
      .values({
        masterIdeaId: carousel.masterIdeaId,
        marketId: carousel.marketId,
        format: "REEL",
        status: "DRAFT",
        sourceVariantId: carousel.id,
        // The Reel posts with the carousel's caption, hashtags and call to action.
        hook: carousel.hook,
        hookType: carousel.hookType,
        caption: carousel.caption,
        cta: carousel.cta,
        ctaType: carousel.ctaType,
        ctaJson: carousel.ctaJson,
        hashtags: carousel.hashtags,
        offerId: carousel.offerId,
      })
      .returning();
  }
  if (!reel) throw new Error("content_variants: the Reel insert returned no row");

  const requestId = ctx.requestId ?? randomUUID();
  const { runId } = await triggerJob(
    ctx,
    "generate-reel",
    {
      variantId: reel.id,
      requestId,
      ...(input.hookId ? { hookId: input.hookId } : {}),
      model,
    },
    { idempotencyKey: `reel:${reel.id}:${requestId}`, tags: [`variant:${reel.id}`] },
  );
  await audit(ctx, {
    action: "reel.requested",
    entityType: "content_variant",
    entityId: reel.id,
    marketId: carousel.marketId,
    data: {
      sourceVariantId: carousel.id,
      model,
      estimateUsd: estimate.totalUsd,
      confirmedUsd: input.confirmEstimateUsd,
      runId,
    },
  });
  return { variantId: reel.id, runId, estimate };
}
