import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import { and, desc, eq, ne } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import {
  DEFAULT_VIDEO_MODEL,
  estimateShotCostUsd,
  VIDEO_MODELS,
  type VideoModelId,
} from "@rc/lib/providers/video";
import { z } from "zod";
import { audit, type ServiceContext, triggerJob } from "../../core";
import { assertReelsEnabled, reelsEnabled } from "./enabled";
import { applyChosenHook } from "./generate";
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

// --- Changes to a Reel that exists (M8-07) --------------------------------------------------
// Both write a new version of the script and run the pipeline from the shots on: changing the hook
// costs nothing (every shot is reused, only the cards and the video change), redoing one shot pays
// for that shot.

const ChangeInput = z.object({ variantId: z.uuid() });

async function changeableReel(ctx: ServiceContext, variantId: string) {
  const [reel] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, variantId));
  if (!reel || reel.format !== "REEL") {
    throw new NotFoundError("Reel not found.", { details: { variantId } });
  }
  if (!REUSABLE.includes(reel.status)) {
    throw new InvalidStateError(
      reel.status === "GENERATING"
        ? "The Reel is being made."
        : `A ${reel.status} Reel is not changed. Un-approve it first.`,
      { details: { code: reel.status === "GENERATING" ? "reel_generating" : "reel_in_use", variantId } },
    );
  }
  const [script] = await ctx.db
    .select()
    .from(schema.reelScripts)
    .where(eq(schema.reelScripts.contentVariantId, variantId))
    .orderBy(desc(schema.reelScripts.version))
    .limit(1);
  if (!script) throw new InvalidStateError("The Reel has no script yet.", { details: { variantId } });
  return { reel, script };
}

/** A copy of the script as the next version (the older versions stay as the history). */
async function nextScript(
  ctx: ServiceContext,
  script: typeof schema.reelScripts.$inferSelect,
  change: Partial<Pick<typeof schema.reelScripts.$inferInsert, "chosenHookId" | "scenes">>,
) {
  const [row] = await ctx.db
    .insert(schema.reelScripts)
    .values({
      contentVariantId: script.contentVariantId,
      version: script.version + 1,
      hookOptions: script.hookOptions,
      chosenHookId: script.chosenHookId,
      flashOpener: script.flashOpener,
      scenes: script.scenes,
      shotModel: script.shotModel,
      costEstimateUsd: script.costEstimateUsd,
      promptVersion: script.promptVersion,
      generationRunId: script.generationRunId,
      ...change,
    })
    .returning();
  if (!row) throw new Error("reel_scripts: the insert returned no row");
  return row;
}

export const ChangeReelHookInput = ChangeInput.extend({ hookId: z.string().min(1) });

/** Another hook option for the Reel: its two cards go on the first two scenes, the video is rebuilt. */
export async function changeReelHook(
  ctx: ServiceContext,
  raw: z.input<typeof ChangeReelHookInput>,
): Promise<{ variantId: string; runId: string; scriptId: string }> {
  const input = ChangeReelHookInput.parse(raw);
  await assertReelsEnabled(ctx);
  const { reel, script } = await changeableReel(ctx, input.variantId);
  if (script.chosenHookId === input.hookId) {
    throw new ValidationError("That hook is already the one in the Reel.", {
      details: { code: "hook_unchanged" },
    });
  }
  if (!script.hookOptions.some((h) => h.id === input.hookId)) {
    throw new ValidationError("There is no such hook option.", { details: { code: "unknown_hook" } });
  }
  const changed = applyChosenHook(
    {
      hookOptions: script.hookOptions,
      chosenHookId: script.chosenHookId ?? "",
      flashOpener: script.flashOpener,
      scenes: script.scenes,
    },
    input.hookId,
  );
  const next = await nextScript(ctx, script, {
    chosenHookId: changed.chosenHookId,
    scenes: changed.scenes,
  });
  const requestId = ctx.requestId ?? randomUUID();
  const { runId } = await triggerJob(
    ctx,
    "generate-reel",
    { variantId: reel.id, requestId, scriptId: next.id, model: script.shotModel as VideoModelId },
    { idempotencyKey: `reel:${reel.id}:${requestId}`, tags: [`variant:${reel.id}`] },
  );
  await audit(ctx, {
    action: "reel.hook_changed",
    entityType: "content_variant",
    entityId: reel.id,
    marketId: reel.marketId,
    data: { from: script.chosenHookId, to: input.hookId, scriptId: next.id, runId },
  });
  return { variantId: reel.id, runId, scriptId: next.id };
}

export const RegenerateReelShotInput = ChangeInput.extend({
  sceneId: z.string().min(1),
  /** The price the owner saw for one shot, in USD. */
  confirmEstimateUsd: z.number().nonnegative(),
});

/** What redoing one shot costs on the Reel's model. */
export function estimateShotRedo(model: VideoModelId): number {
  const e = estimateReel({ model, shots: 1 });
  return Math.round(estimateShotCostUsd(model, e.secondsPerShot, e.resolution) * 10_000) / 10_000;
}

/** Redoes the shot of one scene (the same prompt and picture, a new shot) and rebuilds the video. */
export async function regenerateReelShot(
  ctx: ServiceContext,
  raw: z.input<typeof RegenerateReelShotInput>,
): Promise<{ variantId: string; runId: string; scriptId: string; estimateUsd: number }> {
  const input = RegenerateReelShotInput.parse(raw);
  await assertReelsEnabled(ctx);
  const { reel, script } = await changeableReel(ctx, input.variantId);
  const scene = script.scenes.find((s) => s.id === input.sceneId);
  if (!scene) {
    throw new NotFoundError("The scene is not in the Reel.", { details: { sceneId: input.sceneId } });
  }
  const estimateUsd = estimateShotRedo(script.shotModel as VideoModelId);
  if (input.confirmEstimateUsd + CONFIRM_SLACK_USD < estimateUsd) {
    throw new ValidationError(
      `One shot now costs about $${estimateUsd.toFixed(2)}, not $${input.confirmEstimateUsd.toFixed(2)}. Confirm the new amount.`,
      { details: { code: "estimate_changed", estimateUsd } },
    );
  }
  const next = await nextScript(ctx, script, {
    scenes: script.scenes.map((s) =>
      s.id === scene.id ? { ...s, shotAttempt: (s.shotAttempt ?? 0) + 1, shotId: undefined } : s,
    ),
  });
  const requestId = ctx.requestId ?? randomUUID();
  const { runId } = await triggerJob(
    ctx,
    "generate-reel",
    { variantId: reel.id, requestId, scriptId: next.id, model: script.shotModel as VideoModelId },
    { idempotencyKey: `reel:${reel.id}:${requestId}`, tags: [`variant:${reel.id}`] },
  );
  await audit(ctx, {
    action: "reel.shot_regenerated",
    entityType: "content_variant",
    entityId: reel.id,
    marketId: reel.marketId,
    data: { sceneId: scene.id, attempt: (scene.shotAttempt ?? 0) + 1, scriptId: next.id, estimateUsd, runId },
  });
  return { variantId: reel.id, runId, scriptId: next.id, estimateUsd };
}
