import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@rc/db";
import type { ReelScene } from "@rc/db/json";
import { and, desc, eq } from "@rc/db/orm";
import {
  CREDITS_EXHAUSTED_CODE,
  CREDITS_EXHAUSTED_MESSAGE,
  CreditsExhaustedError,
  InvalidStateError,
  NotFoundError,
  PermanentError,
  TransientError,
} from "@rc/lib/errors";
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS, type VideoModelId } from "@rc/lib/providers/video";
import { z } from "zod";
import { STAGE_CONFIG } from "../../ai";
import { transitionVariant } from "../../content/variants/transition";
import { audit, type ServiceContext } from "../../core";
import { synthesizeBeat } from "../audio";
import { type DirectedReel, directReel, type ReelScriptDraft, reelCaption } from "../director";
import {
  type AssembledReel,
  type AssembleInput,
  type AssembleOptions,
  type AssembleShot,
  assembleReel,
  assemblyInputHash,
  FLASH,
  RENDERER_VERSION,
} from "../render";
import { assertReelsEnabled } from "./enabled";
import { estimateReel } from "./estimate";
import { clearPendingReelFrames, ensureReelFrame, type ReelFrame } from "./frames";
import {
  ensureShots,
  prepareStartFrame,
  SHOT_RESOLUTION,
  SHOT_SECONDS_V4,
  SHOT_TRIM_V4,
  type ShotResult,
  type StartFrame,
} from "./shots";
import { loadReelSource, type ReelSource } from "./source";

// The `generate-reel` job (plan 06 J23, plan 18 §18.4, M8-06): director → shots → assembly → checks,
// for one Reel variant. A reel-director@4 script (its scenes carry frame prompts) first gets a
// picture made for each shot, its shots are 4 s with the model's own sound, and that sound is the
// Reel's audio instead of the placeholder beat. Every stage persists before the next, so a crash
// resumes where it stopped: the script is a row, each picture and each shot is a row found by its
// hash, the render is a row found by its input hash. A permanent failure ends the variant as DRAFT with a flag and the job returns; a transient
// one is rethrown, the variant stays GENERATING and the retry continues.

export const GenerateReelPayload = z.object({
  /** The Reel variant (format REEL). */
  variantId: z.uuid(),
  /** Idempotency of one request: `reel:{variantId}:{requestId}`. */
  requestId: z.string().min(1),
  /** The hook option to use instead of the director's recommendation. */
  hookId: z.string().min(1).optional(),
  model: z.enum(VIDEO_MODELS).optional(),
  /**
   * Use this script of the variant instead of asking the director: "change hook" and "regenerate
   * shot" write a new script version and run the pipeline from the shots on.
   */
  scriptId: z.uuid().optional(),
});
export type GenerateReelPayload = z.infer<typeof GenerateReelPayload>;

export type GenerateReelResult = {
  variantId: string;
  /** PAUSED: the model account is empty; a new request after the top-up continues (M2-13c). */
  status: "READY" | "FAILED" | "PAUSED";
  renderId?: string;
  scriptId?: string;
  shots?: { total: number; reused: number; fallbacks: number };
  /** Director, frames (v4) and shots, list-price estimates in USD. */
  costUsd?: number;
  qaWarnings?: string[];
  error?: { code: string; message: string };
};

export type GenerateReelDeps = {
  /** Test hook: replaces ffmpeg and Chromium. */
  assemble?: (input: AssembleInput, options?: AssembleOptions) => Promise<AssembledReel>;
  assembleOptions?: AssembleOptions;
};

const STAGES = ["DIRECTION", "SHOTS", "ASSEMBLY"] as const;
/** Reel frames drawn at once (reel-director@4). */
const FRAME_CONCURRENCY = 3;
type Stage = (typeof STAGES)[number];
const STARTABLE: readonly string[] = ["DRAFT", "READY_FOR_REVIEW", "CHANGES_REQUESTED"];

type Variant = typeof schema.contentVariants.$inferSelect;
type ScriptRow = typeof schema.reelScripts.$inferSelect;

const runKeyOf = (p: GenerateReelPayload) => `reel:${p.variantId}:${p.requestId}`;

/** Swaps the first two cards for the ones of another hook option (the "change hook" action). */
export function applyChosenHook(script: ReelScriptDraft, hookId: string): ReelScriptDraft {
  const hook = script.hookOptions.find((h) => h.id === hookId);
  if (!hook)
    throw new PermanentError(`There is no hook option "${hookId}".`, {
      details: { code: "unknown_hook" },
    });
  return {
    ...script,
    chosenHookId: hook.id,
    scenes: script.scenes.map((s, i) =>
      i === 0 ? { ...s, card: hook.card } : i === 1 ? { ...s, card: hook.ruleCard } : s,
    ),
  };
}

async function loadReelVariant(ctx: ServiceContext, variantId: string): Promise<Variant> {
  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { variantId } });
  if (variant.format !== "REEL" || !variant.sourceVariantId) {
    throw new InvalidStateError("This is not a Reel variant.", { details: { variantId } });
  }
  return variant;
}

/** Marks the stage as the current one and persists the run's state on the variant. */
async function saveState(
  ctx: ServiceContext,
  variantId: string,
  state: {
    runKey: string;
    stage: Stage;
    completed: Stage[];
    ids: Record<string, string>;
    startedAt: string;
  },
): Promise<void> {
  await ctx.db
    .update(schema.contentVariants)
    .set({
      pipelineState: {
        pipelineRunId: state.runKey,
        stage: state.stage,
        startedAt: state.startedAt,
        completedStages: state.completed,
        runIds: state.ids,
      },
    })
    .where(eq(schema.contentVariants.id, variantId));
}

async function insertScript(
  ctx: ServiceContext,
  variant: Variant,
  directed: DirectedReel,
  script: ReelScriptDraft,
  model: VideoModelId,
): Promise<ScriptRow> {
  const [latest] = await ctx.db
    .select({ version: schema.reelScripts.version })
    .from(schema.reelScripts)
    .where(eq(schema.reelScripts.contentVariantId, variant.id))
    .orderBy(desc(schema.reelScripts.version))
    .limit(1);
  const v4 = script.scenes.some((s) => (s.framePrompt ?? "").trim() !== "");
  const estimate = estimateReel({
    model,
    shots: script.scenes.length,
    format: v4 ? "v4" : "v3",
  });
  const [row] = await ctx.db
    .insert(schema.reelScripts)
    .values({
      contentVariantId: variant.id,
      version: (latest?.version ?? 0) + 1,
      hookOptions: script.hookOptions,
      chosenHookId: script.chosenHookId,
      flashOpener: script.flashOpener,
      scenes: script.scenes,
      shotModel: model,
      costEstimateUsd: estimate.totalUsd.toFixed(4),
      promptVersion: `${STAGE_CONFIG.REEL_DIRECTION.promptId}@${STAGE_CONFIG.REEL_DIRECTION.version}`,
      generationRunId: directed.runId,
    })
    .returning();
  if (!row) throw new Error("reel_scripts: the insert returned no row");
  return row;
}

/**
 * The Reel's own post (reel-director@2) on its variant: the caption under the chosen hook's line,
 * the ask and the hashtags, so the Reel no longer posts with the carousel's text. A keyword ask
 * tied to an offer stays the carousel's own (the director had one code to choose from).
 */
async function savePost(
  ctx: ServiceContext,
  variant: Variant,
  source: ReelSource,
  script: ReelScriptDraft,
): Promise<void> {
  const { post } = script;
  const hook = script.hookOptions.find((h) => h.id === script.chosenHookId);
  if (!post || !hook) return;
  const carouselCta = source.carousel.ctaJson;
  const keepsCarouselCta =
    carouselCta !== null && carouselCta.type === post.cta.type && carouselCta.keyword !== undefined;
  await ctx.db
    .update(schema.contentVariants)
    .set({
      caption: reelCaption(hook, post.body),
      hook: hook.card.replaceAll("**", ""),
      hookType: hook.hookType,
      cta: post.cta.text,
      ctaType: post.cta.type,
      ctaJson: keepsCarouselCta ? { ...carouselCta, text: post.cta.text } : post.cta,
      hashtags: post.hashtags,
    })
    .where(eq(schema.contentVariants.id, variant.id));
}

export async function generateReel(
  ctx: ServiceContext,
  raw: GenerateReelPayload,
  deps: GenerateReelDeps = {},
): Promise<GenerateReelResult> {
  const payload = GenerateReelPayload.parse(raw);
  await assertReelsEnabled(ctx);
  const variant = await loadReelVariant(ctx, payload.variantId);
  const runKey = runKeyOf(payload);
  const model = payload.model ?? DEFAULT_VIDEO_MODEL;

  // Start, or resume this very request; another request in flight is refused.
  const state = variant.pipelineState;
  const resuming = variant.status === "GENERATING" && state?.pipelineRunId === runKey;
  if (variant.status === "GENERATING" && !resuming) {
    throw new InvalidStateError("Another Reel generation is running for this variant.", {
      details: { variantId: variant.id, code: "already_generating" },
    });
  }
  if (!resuming) {
    if (!STARTABLE.includes(variant.status)) {
      throw new InvalidStateError(`A ${variant.status} Reel cannot be generated again.`, {
        details: { variantId: variant.id, status: variant.status },
      });
    }
    await transitionVariant(ctx, {
      variantId: variant.id,
      event: "START_PIPELINE",
      data: { runKey, model },
    });
  }
  // A variant paused for want of credit keeps its old state; a new request starts a new clock.
  const startedAt = (resuming ? state?.startedAt : undefined) ?? ctx.clock.now().toISOString();
  const completed: Stage[] = resuming ? ((state?.completedStages ?? []) as Stage[]) : [];
  const ids: Record<string, string> = resuming ? { ...(state?.runIds ?? {}) } : {};
  let current: Stage = "DIRECTION";
  const progress = (stage: Stage) => {
    current = stage;
    return saveState(ctx, variant.id, { runKey, stage, completed, ids, startedAt });
  };

  const tmp = await mkdtemp(join(tmpdir(), "reel-"));
  let directorCost = 0;
  try {
    const source = await loadReelSource(ctx, variant.sourceVariantId as string);

    // 1. Director -----------------------------------------------------------------------------
    let script: ScriptRow | undefined;
    if (payload.scriptId && !ids.SCRIPT) {
      [script] = await ctx.db
        .select()
        .from(schema.reelScripts)
        .where(
          and(
            eq(schema.reelScripts.id, payload.scriptId),
            eq(schema.reelScripts.contentVariantId, variant.id),
          ),
        );
      if (!script) {
        throw new PermanentError("The script does not belong to this Reel.", {
          details: { code: "script_missing" },
        });
      }
      ids.SCRIPT = script.id;
      completed.push("DIRECTION");
    } else if (completed.includes("DIRECTION") && ids.SCRIPT) {
      [script] = await ctx.db
        .select()
        .from(schema.reelScripts)
        .where(eq(schema.reelScripts.id, ids.SCRIPT));
    }
    if (!script) {
      await progress("DIRECTION");
      const directed = await directReel(ctx, source.directorInput, {
        locale: source.locale,
        forbiddenPatterns: source.market.forbiddenPatterns,
        inputRefs: { variantId: variant.id, masterIdeaId: source.idea.id },
      });
      directorCost = directed.costUsd ?? 0;
      ids.DIRECTOR_USD = String(directorCost);
      if (!directed.script) {
        throw new PermanentError("The Reel director could not write a valid script.", {
          details: {
            code: "script_invalid",
            status: directed.status,
            issues: directed.issues.map((i) => i.code),
          },
        });
      }
      const draft = payload.hookId
        ? applyChosenHook(directed.script, payload.hookId)
        : directed.script;
      script = await insertScript(ctx, variant, directed, draft, model);
      await savePost(ctx, variant, source, draft);
      ids.DIRECTION = directed.runId;
      ids.SCRIPT = script.id;
      completed.push("DIRECTION");
    }
    const scriptRow = script;
    directorCost = directorCost || Number(ids.DIRECTOR_USD ?? 0);

    // 2. Shots ---------------------------------------------------------------------------------
    await progress("SHOTS");
    const v4 = scriptRow.scenes.some((s) => (s.framePrompt ?? "").trim() !== "");
    // reel-director@4: the pictures made for the shots, one per distinct frame prompt, a few at a time.
    const made = new Map<string, ReelFrame | null>();
    if (v4) {
      await clearPendingReelFrames(
        ctx,
        variant.id,
        scriptRow.scenes.map((s) => s.id),
      );
      const wanted = [
        ...new Map(
          scriptRow.scenes
            .filter((s) => (s.framePrompt ?? "").trim() !== "")
            .map((s) => [(s.framePrompt ?? "").trim(), s.id] as const),
        ),
      ];
      let next = 0;
      const worker = async () => {
        while (next < wanted.length) {
          const item = wanted[next++];
          if (!item) return;
          const [framePrompt, sceneId] = item;
          made.set(
            framePrompt,
            await ensureReelFrame(
              ctx,
              { brandId: source.idea.brandId, variantId: variant.id },
              { id: sceneId, framePrompt },
            ),
          );
        }
      };
      await Promise.all(Array.from({ length: Math.min(FRAME_CONCURRENCY, wanted.length) }, worker));
    }
    // A frame made in an earlier attempt of this run is reused at no cost: keep what it cost then.
    const framesCost = [...made.values()].reduce((sum, f) => sum + (f?.costUsd ?? 0), 0);
    if (framesCost > 0) ids.FRAMES_USD = String(framesCost);
    const frames = new Map<string, StartFrame>();
    const specs = [];
    for (const scene of scriptRow.scenes) {
      const reelFrame = made.get((scene.framePrompt ?? "").trim());
      if (reelFrame) {
        let frame = frames.get(reelFrame.assetId);
        if (!frame) {
          frame = await prepareStartFrame(reelFrame.bytes, SHOT_RESOLUTION, "cover");
          frames.set(reelFrame.assetId, frame);
        }
        specs.push({
          sceneId: scene.id,
          prompt: scene.shotPrompt,
          pictureId: reelFrame.assetId,
          frame,
          seconds: SHOT_SECONDS_V4,
          audio: true,
          ...(scene.shotAttempt ? { attempt: scene.shotAttempt } : {}),
        });
        continue;
      }
      const picture = source.pictures.find((p) => p.assetId === scene.sourcePictureId);
      if (!picture) {
        throw new PermanentError(`Scene ${scene.id} uses a picture that is not in the carousel.`, {
          details: { code: "picture_missing", sceneId: scene.id },
        });
      }
      let frame = frames.get(picture.assetId);
      if (!frame) {
        frame = await prepareStartFrame(await ctx.storage.getBytes(picture.storageKey));
        frames.set(picture.assetId, frame);
      }
      specs.push({
        sceneId: scene.id,
        prompt: scene.shotPrompt,
        pictureId: picture.assetId,
        frame,
        // A v4 scene whose picture could not be made starts from the carousel picture, same length.
        ...(v4 ? { seconds: SHOT_SECONDS_V4, audio: true } : {}),
        ...(scene.shotAttempt ? { attempt: scene.shotAttempt } : {}),
      });
    }
    const shots = await ensureShots(
      ctx,
      {
        brandId: source.idea.brandId,
        variantId: variant.id,
        masterIdeaId: source.idea.id,
        model: scriptRow.shotModel as VideoModelId,
        resolution: "720p",
      },
      specs,
      async (done) => {
        ids.SHOTS_READY = String(done);
        await progress("SHOTS");
      },
    );
    if (shots.failures.length > 0) {
      // A transient problem anywhere is retried as a whole (finished shots are reused); otherwise the first refusal ends the run.
      const transient = shots.failures.find((f) => f.error instanceof TransientError);
      throw (transient ?? shots.failures[0])?.error;
    }
    const shotByScene = new Map<string, ShotResult>(shots.results.map((r) => [r.sceneId, r]));
    const scenes: ReelScene[] = scriptRow.scenes.map((s) => ({
      ...s,
      shotId: shotByScene.get(s.id)?.shotId ?? s.shotId,
    }));
    await ctx.db
      .update(schema.reelScripts)
      .set({ scenes })
      .where(eq(schema.reelScripts.id, scriptRow.id));
    if (!completed.includes("SHOTS")) completed.push("SHOTS");

    // 3. Assembly ------------------------------------------------------------------------------
    await progress("ASSEMBLY");
    const shotsDir = join(tmp, "shots");
    await mkdir(shotsDir, { recursive: true });
    const assembleShots: Record<string, AssembleShot> = {};
    for (const scene of scenes) {
      const shot = shotByScene.get(scene.id);
      if (!shot) throw new Error(`No shot for scene ${scene.id}`);
      const path = join(shotsDir, `${scene.id}.mp4`);
      await writeFile(path, await ctx.storage.getBytes(shot.storageKey));
      assembleShots[scene.id] = {
        path,
        sha256: shot.sha256,
        ...(v4 ? { trimStartSeconds: SHOT_TRIM_V4 } : {}),
      };
    }
    const flashOpener = scriptRow.flashOpener === "ON";
    let audio: AssembleInput["audio"];
    if (v4) {
      // reel-director@4: the sound the model made with each shot.
      audio = { kind: "MODEL_AUDIO" };
    } else {
      // The placeholder beat, cut to this script: the same script always gets the same file.
      const peakIndex = scenes.findIndex((s) => s.role === "PEAK");
      const beat = synthesizeBeat({
        sceneBeats: scenes.map((s) => s.beats),
        flashSeconds: flashOpener ? FLASH.shots * FLASH.shotSeconds : 0,
        peakSceneIndex: peakIndex >= 0 ? peakIndex : undefined,
      });
      const audioPath = join(tmp, "beat.wav");
      await writeFile(audioPath, beat.wav);
      audio = {
        path: audioPath,
        kind: "PLACEHOLDER_BEAT",
        sha256: createHash("sha256").update(beat.wav).digest("hex"),
      };
    }
    const input: AssembleInput = {
      scenes: scenes.map((s) => ({
        id: s.id,
        beats: s.beats,
        card: s.card,
        ...(s.line?.trim() ? { line: s.line.trim() } : {}),
        layout: s.layout,
      })),
      shots: assembleShots,
      flashOpener,
      audio,
      workDir: join(tmp, "work"),
      outPath: join(tmp, "reel.mp4"),
    };
    const inputHash = assemblyInputHash(input);
    const framesUsd = Number(ids.FRAMES_USD ?? 0);
    const shotsCost = shots.results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

    let renderId: string;
    let qaWarnings: string[] = [];
    const [existing] = await ctx.db
      .select()
      .from(schema.reelRenders)
      .where(
        and(
          eq(schema.reelRenders.contentVariantId, variant.id),
          eq(schema.reelRenders.inputHash, inputHash),
        ),
      );
    if (existing?.status === "READY") {
      renderId = existing.id;
      qaWarnings = existing.qaReport?.warnings ?? [];
    } else {
      const base = {
        reelScriptId: scriptRow.id,
        status: "RENDERING" as const,
        rendererVersion: RENDERER_VERSION,
        costUsd: (shotsCost + framesUsd).toFixed(4),
        error: null,
        completedAt: null,
        triggerRunId: ctx.actor.type === "JOB" ? ctx.actor.jobRunId : null,
      };
      const [row] = existing
        ? await ctx.db
            .update(schema.reelRenders)
            .set(base)
            .where(eq(schema.reelRenders.id, existing.id))
            .returning()
        : await ctx.db
            .insert(schema.reelRenders)
            .values({ contentVariantId: variant.id, inputHash, ...base })
            .returning();
      renderId = row?.id ?? "";
      try {
        const assembled = await (deps.assemble ?? assembleReel)(input, deps.assembleOptions);
        const key = `renders/reels/${variant.id}/${renderId}.mp4`;
        await ctx.storage.put(key, await readFile(assembled.path), { contentType: "video/mp4" });
        await ctx.db
          .update(schema.reelRenders)
          .set({
            status: "READY",
            width: assembled.width,
            height: assembled.height,
            durationMs: assembled.durationMs,
            bytes: assembled.bytes,
            sha256: assembled.sha256,
            storageKey: key,
            audioKind: assembled.audioKind,
            qaReport: assembled.qa,
            completedAt: ctx.clock.now(),
          })
          .where(eq(schema.reelRenders.id, renderId));
        qaWarnings = assembled.qa.warnings;
      } catch (error) {
        await ctx.db
          .update(schema.reelRenders)
          .set({
            status: "FAILED",
            error: {
              code: "ASSEMBLY_FAILED",
              message: error instanceof Error ? error.message : String(error),
            },
            completedAt: ctx.clock.now(),
          })
          .where(eq(schema.reelRenders.id, renderId));
        throw error;
      }
    }
    completed.push("ASSEMBLY");

    // 4. Done ------------------------------------------------------------------------------------
    const totalCost = Math.round((shotsCost + framesUsd + directorCost) * 10_000) / 10_000;
    await transitionVariant(ctx, {
      variantId: variant.id,
      event: "PIPELINE_SUCCESS",
      set: {
        currentReelRenderId: renderId,
        pipelineState: null,
        lastError: null,
        flags: variant.flags.filter((f) => f !== "GENERATION_FAILED"),
      },
      data: { runKey, scriptId: scriptRow.id, renderId, costUsd: totalCost },
    });
    const reused = shots.results.filter((r) => r.reused).length;
    const fallbacks = shots.results.filter((r) => r.usedFallback).length;
    await audit(ctx, {
      action: "reel.generated",
      entityType: "content_variant",
      entityId: variant.id,
      marketId: variant.marketId,
      data: {
        renderId,
        scriptId: scriptRow.id,
        shots: shots.results.length,
        reused,
        fallbacks,
        directorUsd: directorCost,
        shotsUsd: shotsCost,
        ...(framesUsd > 0 ? { framesUsd } : {}),
        qaWarnings,
      },
    });
    return {
      variantId: variant.id,
      status: "READY",
      renderId,
      scriptId: scriptRow.id,
      shots: { total: shots.results.length, reused, fallbacks },
      costUsd: totalCost,
      qaWarnings,
    };
  } catch (error) {
    // Waiting again can help: keep the state and let the job retry. Anything else ends the run.
    if (error instanceof TransientError) throw error;
    if (error instanceof CreditsExhaustedError) {
      // An empty account is a pause, not a failure: the state stays, no failure flag, and the next
      // request after the top-up finds the finished script, shots and render by their rows.
      await transitionVariant(ctx, {
        variantId: variant.id,
        event: "PIPELINE_FAILURE",
        set: {
          pipelineState: {
            pipelineRunId: runKey,
            stage: current,
            startedAt,
            completedStages: completed,
            runIds: ids,
          },
          lastError: {
            code: CREDITS_EXHAUSTED_CODE,
            message: CREDITS_EXHAUSTED_MESSAGE,
            details: { stage: current, resumable: true },
          },
          flags: variant.flags.filter((f) => f !== "GENERATION_FAILED"),
        },
        data: { runKey, code: CREDITS_EXHAUSTED_CODE },
      });
      await audit(ctx, {
        action: "reel.paused",
        entityType: "content_variant",
        entityId: variant.id,
        marketId: variant.marketId,
        data: { code: CREDITS_EXHAUSTED_CODE, stage: current, completedStages: completed },
      });
      return {
        variantId: variant.id,
        status: "PAUSED",
        error: { code: CREDITS_EXHAUSTED_CODE, message: CREDITS_EXHAUSTED_MESSAGE },
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { details?: { code?: string } } | null)?.details?.code ?? "REEL_FAILED";
    await transitionVariant(ctx, {
      variantId: variant.id,
      event: "PIPELINE_FAILURE",
      set: {
        pipelineState: null,
        lastError: { code, message },
        flags: [...new Set([...variant.flags, "GENERATION_FAILED" as const])],
      },
      data: { runKey, code },
    });
    await audit(ctx, {
      action: "reel.failed",
      entityType: "content_variant",
      entityId: variant.id,
      marketId: variant.marketId,
      data: { code, message },
    });
    return { variantId: variant.id, status: "FAILED", error: { code, message } };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export type { ReelSource };
