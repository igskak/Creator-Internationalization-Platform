import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@rc/db";
import type { ReelScene } from "@rc/db/json";
import { and, desc, eq } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, PermanentError, TransientError } from "@rc/lib/errors";
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS, type VideoModelId } from "@rc/lib/providers/video";
import { z } from "zod";
import { transitionVariant } from "../../content/variants/transition";
import { audit, type ServiceContext } from "../../core";
import { synthesizeBeat } from "../audio";
import { type DirectedReel, directReel, type ReelScriptDraft } from "../director";
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
import { ensureShots, prepareStartFrame, type ShotResult, type StartFrame } from "./shots";
import { loadReelSource, type ReelSource } from "./source";

// The `generate-reel` job (plan 06 J23, plan 18 §18.4, M8-06): director → shots → assembly → checks,
// for one Reel variant. Every stage persists before the next, so a crash resumes where it stopped:
// the script is a row, each shot is a row found by its hash, the render is a row found by its input
// hash. A permanent failure ends the variant as DRAFT with a flag and the job returns; a transient
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
  status: "READY" | "FAILED";
  renderId?: string;
  scriptId?: string;
  shots?: { total: number; reused: number; fallbacks: number };
  /** Director + shots, list-price estimates in USD. */
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
  const estimate = estimateReel({ model, shots: script.scenes.length });
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
      promptVersion: "reel-director@1",
      generationRunId: directed.runId,
    })
    .returning();
  if (!row) throw new Error("reel_scripts: the insert returned no row");
  return row;
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
  const startedAt = state?.startedAt ?? ctx.clock.now().toISOString();
  const completed: Stage[] = resuming ? ((state?.completedStages ?? []) as Stage[]) : [];
  const ids: Record<string, string> = resuming ? { ...(state?.runIds ?? {}) } : {};
  const progress = (stage: Stage) =>
    saveState(ctx, variant.id, { runKey, stage, completed, ids, startedAt });

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
      ids.DIRECTION = directed.runId;
      ids.SCRIPT = script.id;
      completed.push("DIRECTION");
    }
    const scriptRow = script;
    directorCost = directorCost || Number(ids.DIRECTOR_USD ?? 0);

    // 2. Shots ---------------------------------------------------------------------------------
    await progress("SHOTS");
    const frames = new Map<string, StartFrame>();
    const specs = [];
    for (const scene of scriptRow.scenes) {
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
      assembleShots[scene.id] = { path, sha256: shot.sha256 };
    }
    // The placeholder beat, cut to this script: the same script always gets the same file.
    const flashOpener = scriptRow.flashOpener === "ON";
    const peakIndex = scenes.findIndex((s) => s.role === "PEAK");
    const beat = synthesizeBeat({
      sceneBeats: scenes.map((s) => s.beats),
      flashSeconds: flashOpener ? FLASH.shots * FLASH.shotSeconds : 0,
      peakSceneIndex: peakIndex >= 0 ? peakIndex : undefined,
    });
    const audioPath = join(tmp, "beat.wav");
    await writeFile(audioPath, beat.wav);
    const input: AssembleInput = {
      scenes: scenes.map((s) => ({ id: s.id, beats: s.beats, card: s.card, layout: s.layout })),
      shots: assembleShots,
      flashOpener,
      audio: {
        path: audioPath,
        kind: "PLACEHOLDER_BEAT",
        sha256: createHash("sha256").update(beat.wav).digest("hex"),
      },
      workDir: join(tmp, "work"),
      outPath: join(tmp, "reel.mp4"),
    };
    const inputHash = assemblyInputHash(input);
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
        costUsd: shotsCost.toFixed(4),
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
    const totalCost = Math.round((shotsCost + directorCost) * 10_000) / 10_000;
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
