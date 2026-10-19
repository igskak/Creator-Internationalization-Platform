import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import { and, eq, inArray } from "@rc/db/orm";
import { PermanentError } from "@rc/lib/errors";
import {
  DEFAULT_VIDEO_MODEL,
  PORTRAIT_SIZES,
  type ShotHandle,
  shotDurationRange,
  type VideoModelId,
  type VideoResolution,
} from "@rc/lib/providers/video";
import sharp from "sharp";
import type { ServiceContext } from "../../core";

// Shots of a Reel (plan 18 §18.4 step 2). A shot is one image-to-video request, found again by the
// hash of what it is made of, so a rerun, a crashed run that resumes, and another market with the
// same picture and prompt never pay twice. The vendor keeps files only temporarily: the mp4 goes
// to storage as soon as it arrives.

export const SHOT_SECONDS = 3;
/**
 * reel-director@4: a scene lasts up to 3.5 s and the first 0.2 s of a clip (still the start frame)
 * are cut, so a shot is 4 s long.
 */
export const SHOT_SECONDS_V4 = 4;
/** Where a v4 scene starts in its clip: the model's first frames barely move. */
export const SHOT_TRIM_V4 = 0.2;
export const SHOT_RESOLUTION: VideoResolution = "720p";
/** Shots in flight at once; the vendor's rate limits are not published (V-24). */
export const SHOT_CONCURRENCY = 4;
/** Used once when moderation or the model refuses a shot: a still picture with a light shift. */
export const FALLBACK_SHOT_PROMPT =
  "Static camera. A soft light slowly shifts over the subject while everything else stays still.";

export type Row = typeof schema.reelShots.$inferSelect;

/** Whole seconds a shot lasts with this model: three, or the model's minimum when higher. */
export const shotSecondsFor = (model: VideoModelId): number =>
  Math.max(SHOT_SECONDS, shotDurationRange(model).min);

export type StartFrame = { bytes: Uint8Array; mimeType: "image/jpeg"; sha256: string };

/**
 * The picture as a 9:16 frame on pure white (reel-style.md "Picture"), the size the model returns.
 * A carousel picture is padded (`contain`); a frame made for the Reel is cut to fill (`cover`).
 */
export async function prepareStartFrame(
  picture: Uint8Array,
  resolution: VideoResolution = SHOT_RESOLUTION,
  fit: "contain" | "cover" = "contain",
): Promise<StartFrame> {
  const { width, height } = PORTRAIT_SIZES[resolution];
  const jpeg = await sharp(picture)
    .flatten({ background: "#ffffff" })
    .resize(width, height, { fit, background: "#ffffff" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return {
    bytes: new Uint8Array(jpeg),
    mimeType: "image/jpeg",
    sha256: createHash("sha256").update(jpeg).digest("hex"),
  };
}

/** Model, resolution, seconds, prompt and the start frame: the same inputs make the same shot. */
export const shotPromptHash = (parts: {
  model: VideoModelId;
  resolution: VideoResolution;
  seconds: number;
  prompt: string;
  frameSha256: string;
  /** How often the shot was redone; the first make is 0 and leaves the hash as it was. */
  attempt?: number;
  /** The model's own sound (v4); off leaves the hash as it was. */
  audio?: boolean;
}): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        parts.model,
        parts.resolution,
        parts.seconds,
        parts.prompt,
        parts.frameSha256,
        ...(parts.attempt ? [parts.attempt] : []),
        ...(parts.audio ? ["audio"] : []),
      ]),
    )
    .digest("hex");

export type ShotSpec = {
  sceneId: string;
  prompt: string;
  /** `visual_assets.id` of the picture the shot starts from. */
  pictureId: string;
  frame: StartFrame;
  /** "Regenerate shot": the number of the redo; 0 or missing for the first make. */
  attempt?: number;
  /** Whole seconds of the clip; default `shotSecondsFor(model)`. */
  seconds?: number;
  /** Ask the model for its own sound (v4). */
  audio?: boolean;
};

export type ShotResult = {
  sceneId: string;
  shotId: string;
  storageKey: string;
  sha256: string;
  costUsd: number | null;
  /** True when a READY shot of the same hash already existed (this run did not pay). */
  reused: boolean;
  /** True when the fallback prompt had to be used. */
  usedFallback: boolean;
};

type ShotContext = {
  brandId: string;
  variantId: string;
  masterIdeaId: string;
  model: VideoModelId;
  resolution: VideoResolution;
};

const errorCode = (error: unknown): string | undefined => {
  const details = (error as { details?: { code?: unknown } } | null)?.details;
  return typeof details?.code === "string" ? details.code : undefined;
};
/** The vendor refused this shot (moderation, a failed job): another prompt may work. */
const isRefusal = (error: unknown): boolean =>
  error instanceof PermanentError &&
  ["nsfw", "failed", "canceled"].includes(errorCode(error) ?? "");

/** Records the vendor call in `generation_runs` (decision RL-4: every shot is a run). */
async function recordRun(
  ctx: ServiceContext,
  shot: Row,
  shotCtx: ShotContext,
  outcome: {
    status: "SUCCEEDED" | "FAILED";
    costUsd?: number | null;
    latencyMs: number;
    error?: unknown;
  },
): Promise<string> {
  const [row] = await ctx.db
    .insert(schema.generationRuns)
    .values({
      stage: "REEL_SHOT",
      promptId: "video-shot",
      promptVersion: 1,
      promptHash: shot.promptHash,
      provider: ctx.video.id,
      model: shot.model,
      params: { durationSeconds: shot.durationSeconds, resolution: shot.resolution } as never,
      request: { prompt: shot.prompt, frameSha256: shot.sourceFrameSha256 },
      inputRefs: { variantId: shotCtx.variantId },
      inputHash: shot.promptHash,
      output: outcome.status === "SUCCEEDED" ? { providerRequestId: shot.providerRequestId } : null,
      status: outcome.status,
      costUsd: outcome.costUsd == null ? null : outcome.costUsd.toFixed(4),
      latencyMs: outcome.latencyMs,
      error:
        outcome.error === undefined
          ? null
          : {
              code: errorCode(outcome.error) ?? "SHOT_FAILED",
              message:
                outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
            },
      triggerRunId: ctx.actor.type === "JOB" ? ctx.actor.jobRunId : null,
      masterIdeaId: shotCtx.masterIdeaId,
      contentVariantId: shotCtx.variantId,
    })
    .returning({ id: schema.generationRuns.id });
  return row?.id ?? "";
}

/** The live (PENDING, RUNNING, READY) shot of this hash, or a new PENDING row for it. */
async function claimShot(
  ctx: ServiceContext,
  shotCtx: ShotContext,
  spec: ShotSpec,
  prompt: string,
  seconds: number,
): Promise<Row> {
  const promptHash = shotPromptHash({
    model: shotCtx.model,
    resolution: shotCtx.resolution,
    seconds,
    prompt,
    frameSha256: spec.frame.sha256,
    ...(spec.attempt ? { attempt: spec.attempt } : {}),
    ...(spec.audio ? { audio: true } : {}),
  });
  const live = () =>
    ctx.db
      .select()
      .from(schema.reelShots)
      .where(
        and(
          eq(schema.reelShots.brandId, shotCtx.brandId),
          eq(schema.reelShots.promptHash, promptHash),
          inArray(schema.reelShots.status, ["PENDING", "RUNNING", "READY"]),
        ),
      );
  const [existing] = await live();
  if (existing) return existing;
  await ctx.db
    .insert(schema.reelShots)
    .values({
      brandId: shotCtx.brandId,
      contentVariantId: shotCtx.variantId,
      promptHash,
      status: "PENDING",
      provider: ctx.video.id,
      model: shotCtx.model,
      prompt,
      durationSeconds: seconds,
      resolution: shotCtx.resolution,
      sourceVisualAssetId: spec.pictureId,
      sourceFrameSha256: spec.frame.sha256,
    })
    .onConflictDoNothing();
  const [row] = await live();
  if (!row) throw new Error("reel_shots: the claimed shot is missing");
  return row;
}

/** Runs one shot to READY: submit when nothing was sent, wait for a request that is already running. */
async function produce(
  ctx: ServiceContext,
  shotCtx: ShotContext,
  spec: ShotSpec,
  row: Row,
): Promise<Row> {
  const started = ctx.clock.now().getTime();
  let handle: ShotHandle;
  if (row.status === "RUNNING" && row.providerRequestId) {
    handle = {
      requestId: row.providerRequestId,
      model: row.model as VideoModelId,
      durationSeconds: row.durationSeconds,
      resolution: row.resolution as VideoResolution,
    };
  } else {
    handle = await ctx.video.submit({
      prompt: row.prompt,
      image: { bytes: spec.frame.bytes, mimeType: spec.frame.mimeType },
      durationSeconds: row.durationSeconds,
      resolution: row.resolution as VideoResolution,
      model: row.model as VideoModelId,
      idempotencyKey: `reel-shot:${row.promptHash}`,
      label: spec.sceneId,
      ...(spec.audio ? { audio: true } : {}),
    });
    await ctx.db
      .update(schema.reelShots)
      .set({ status: "RUNNING", providerRequestId: handle.requestId, error: null })
      .where(eq(schema.reelShots.id, row.id));
  }
  // A timeout is a TransientError that keeps the request id: the row stays RUNNING and the job's
  // retry waits again without paying twice.
  const shot = await ctx.video.waitFor(handle);
  const key = `reels/shots/${shotCtx.brandId}/${row.id}.mp4`;
  await ctx.storage.put(key, shot.bytes, { contentType: shot.mimeType });
  const sha256 = createHash("sha256").update(shot.bytes).digest("hex");
  const finished: Row = { ...row, providerRequestId: handle.requestId, status: "RUNNING" };
  const runId = await recordRun(ctx, finished, shotCtx, {
    status: "SUCCEEDED",
    costUsd: shot.costUsd,
    latencyMs: ctx.clock.now().getTime() - started,
  });
  const [ready] = await ctx.db
    .update(schema.reelShots)
    .set({
      status: "READY",
      storageKey: key,
      width: shot.width,
      height: shot.height,
      bytes: shot.bytes.byteLength,
      sha256,
      costUsd: shot.costUsd == null ? null : shot.costUsd.toFixed(4),
      params: shot.params,
      generationRunId: runId,
      error: null,
    })
    .where(eq(schema.reelShots.id, row.id))
    .returning();
  if (!ready) throw new Error("reel_shots: the update returned no row");
  return ready;
}

async function markFailed(
  ctx: ServiceContext,
  shotCtx: ShotContext,
  row: Row,
  error: unknown,
  started: number,
): Promise<void> {
  const blocked = errorCode(error) === "nsfw";
  const runId = await recordRun(ctx, row, shotCtx, {
    status: "FAILED",
    latencyMs: ctx.clock.now().getTime() - started,
    error,
  });
  await ctx.db
    .update(schema.reelShots)
    .set({
      status: blocked ? "BLOCKED" : "FAILED",
      generationRunId: runId,
      error: {
        code: errorCode(error) ?? "SHOT_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    })
    .where(eq(schema.reelShots.id, row.id));
}

const toResult = (
  spec: ShotSpec,
  row: Row,
  reused: boolean,
  usedFallback: boolean,
): ShotResult => ({
  sceneId: spec.sceneId,
  shotId: row.id,
  storageKey: row.storageKey ?? "",
  sha256: row.sha256 ?? "",
  costUsd: row.costUsd == null ? null : Number(row.costUsd),
  reused,
  usedFallback,
});

/**
 * One shot of a scene to READY. A READY shot of the same hash is reused; one that is RUNNING is
 * waited for; otherwise the shot is sent. A refusal (moderation or a failed job) is retried once
 * with the fallback prompt; if that is refused too, the error stops the run.
 */
export async function ensureShot(
  ctx: ServiceContext,
  shotCtx: ShotContext,
  spec: ShotSpec,
): Promise<ShotResult> {
  const seconds = Math.max(spec.seconds ?? 0, shotSecondsFor(shotCtx.model));
  let row = await claimShot(ctx, shotCtx, spec, spec.prompt, seconds);
  if (row.status === "READY") return toResult(spec, row, true, false);
  const started = ctx.clock.now().getTime();
  try {
    return toResult(spec, await produce(ctx, shotCtx, spec, row), false, false);
  } catch (error) {
    if (!isRefusal(error)) throw error;
    await markFailed(ctx, shotCtx, row, error, started);
  }
  // The fallback: the same picture with a still prompt.
  row = await claimShot(ctx, shotCtx, spec, FALLBACK_SHOT_PROMPT, seconds);
  if (row.status === "READY") return toResult(spec, row, true, true);
  const fallbackStarted = ctx.clock.now().getTime();
  try {
    return toResult(spec, await produce(ctx, shotCtx, spec, row), false, true);
  } catch (error) {
    if (isRefusal(error)) await markFailed(ctx, shotCtx, row, error, fallbackStarted);
    throw error;
  }
}

export type EnsureShotsResult = {
  results: ShotResult[];
  failures: { sceneId: string; error: unknown }[];
};

/** All scenes' shots, `SHOT_CONCURRENCY` at a time; the others finish when one fails. */
export async function ensureShots(
  ctx: ServiceContext,
  shotCtx: ShotContext,
  specs: readonly ShotSpec[],
  /** Called after each finished shot with the number done so far (the progress panel reads it). */
  onProgress?: (done: number) => Promise<void>,
): Promise<EnsureShotsResult> {
  const results: ShotResult[] = [];
  const failures: EnsureShotsResult["failures"] = [];
  let next = 0;
  const worker = async () => {
    while (next < specs.length) {
      const spec = specs[next++];
      if (!spec) return;
      try {
        results.push(await ensureShot(ctx, shotCtx, spec));
        await onProgress?.(results.length);
      } catch (error) {
        failures.push({ sceneId: spec.sceneId, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SHOT_CONCURRENCY, specs.length) }, worker));
  return { results, failures };
}

export type { ShotContext };
export { DEFAULT_VIDEO_MODEL };
