import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { schema } from "@rc/db";
import { ReelEmotion, ReelHookOption, ReelSceneRole } from "@rc/db/json";
import { desc, eq } from "@rc/db/orm";
import { InvalidStateError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { transitionVariant } from "../../content/variants/transition";
import { audit, type ServiceContext } from "../../core";
import { reelCaption } from "../director";
import { defaultExec, type Exec, probeReel } from "../render";
import { findReel, REUSABLE } from "./request";
import { loadReelSource } from "./source";

// A Reel video made outside the app (a hand-made test, an edit in a video editor) attached to the
// Reel draft of its carousel (`pnpm rc reel-attach`), so it is reviewed, approved and published like
// a generated one: the script the video shows becomes the next script version, the file becomes a
// READY render, the variant goes through the pipeline transitions to READY_FOR_REVIEW. Nothing is
// generated or paid for. The file is checked with ffprobe as the assembly's own output is.

/** What Instagram takes as a Reel and the app publishes (plan 18 §18.4). */
const VIDEO_LIMITS = { width: 1080, height: 1920, minMs: 3_000, maxMs: 90_000 } as const;

const Scene = z.object({
  role: ReelSceneRole,
  emotion: ReelEmotion,
  /** Length on the 120 BPM grid (0.5 s a beat), as the video shows it. */
  beats: z.number().min(3).max(7).multipleOf(0.5),
  card: z.string().min(1),
  line: z.string().optional(),
  framePrompt: z.string().optional(),
  /** What the shot shows; kept for the record, nothing is generated from it. */
  shotPrompt: z.string().min(1),
  claimSlideIds: z.array(z.string().min(1)).default([]),
});

/** The script of the attached video: the cards on screen, the hook options, optionally the post. */
export const AttachedReelScript = z.object({
  hookOptions: z.array(ReelHookOption).min(1).max(3),
  chosenHookId: z.string().min(1),
  scenes: z.array(Scene).min(3).max(12),
  post: z
    .object({
      /** The caption without its first line, which is written from the chosen hook. */
      body: z.string().min(1).max(1500),
      cta: z.object({ type: z.string().min(1), text: z.string().min(1) }),
      hashtags: z
        .array(z.string().regex(/^#[\p{L}\p{N}_]+$/u))
        .min(1)
        .max(5),
    })
    .optional(),
});
export type AttachedReelScript = z.input<typeof AttachedReelScript>;

export const AttachReelVideoInput = z.object({
  /** The carousel the Reel retells (its idea and market find the Reel draft). */
  carouselVariantId: z.uuid(),
  /** Local mp4 file. */
  videoPath: z.string().min(1),
  script: AttachedReelScript,
  /** What the video's sound is: the video model's own (MODEL_AUDIO) by default. */
  audioKind: z.enum(["MODEL_AUDIO", "PLACEHOLDER_BEAT", "OWNER_TRACK"]).default("MODEL_AUDIO"),
  /** What making it cost outside the app, in USD (shown with the Reel); default unknown. */
  costUsd: z.number().nonnegative().optional(),
});

export type AttachReelVideoOptions = { exec?: Exec; ffmpeg?: string; ffprobe?: string };

export type AttachedReel = {
  variantId: string;
  created: boolean;
  scriptId: string;
  scriptVersion: number;
  renderId: string;
  durationMs: number;
  warnings: string[];
};

export async function attachReelVideo(
  ctx: ServiceContext,
  raw: z.input<typeof AttachReelVideoInput>,
  options: AttachReelVideoOptions = {},
): Promise<AttachedReel> {
  const input = AttachReelVideoInput.parse(raw);
  const { script } = input;
  const source = await loadReelSource(ctx, input.carouselVariantId);
  const { carousel } = source;

  // The script: the chosen hook's card opens the video, every cited slide is a slide of the carousel.
  const chosen = script.hookOptions.find((h) => h.id === script.chosenHookId);
  if (!chosen) throw new ValidationError(`There is no hook option "${script.chosenHookId}".`);
  if (script.scenes[0]?.card !== chosen.card) {
    throw new ValidationError("The first scene's card must be the chosen hook's card.");
  }
  const slideIds = new Set(carousel.slidesJson.map((s) => s.id));
  const unknown = [
    ...script.hookOptions.flatMap((h) => h.claimSlideIds),
    ...script.scenes.flatMap((s) => s.claimSlideIds),
  ].filter((id) => !slideIds.has(id));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown slide ids: ${[...new Set(unknown)].join(", ")}.`, {
      details: { slideIds: [...slideIds] },
    });
  }
  const picture = source.pictures[0];
  if (!picture) throw new InvalidStateError("The carousel has no pictures.");

  // The file: what the assembly checks on its own output.
  const tools = {
    exec: options.exec ?? defaultExec,
    ffmpeg: options.ffmpeg ?? "ffmpeg",
    ffprobe: options.ffprobe ?? "ffprobe",
  };
  const { probe, qa } = await probeReel(input.videoPath, tools, []);
  const problems = [
    probe.width !== VIDEO_LIMITS.width || probe.height !== VIDEO_LIMITS.height
      ? `the video is ${probe.width}×${probe.height}, it must be 1080×1920`
      : "",
    probe.videoCodec !== "h264" ? `the video codec is ${probe.videoCodec}, it must be H.264` : "",
    probe.durationMs < VIDEO_LIMITS.minMs || probe.durationMs > VIDEO_LIMITS.maxMs
      ? `the video lasts ${probe.durationMs / 1000} s, it must be 3–90 s`
      : "",
  ].filter(Boolean);
  if (problems.length > 0) throw new ValidationError(`Not a Reel: ${problems.join("; ")}.`);
  const warnings = [...qa.warnings];
  const scriptMs = script.scenes.reduce((sum, s) => sum + s.beats, 0) * 500;
  if (Math.abs(scriptMs - probe.durationMs) > 1_000) {
    warnings.push(
      `The script's scenes last ${scriptMs / 1000} s and the video ${probe.durationMs / 1000} s.`,
    );
  }
  const bytes = new Uint8Array(await readFile(input.videoPath));
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // The Reel draft of this idea and market, or a new one with the carousel's post.
  let reel = await findReel(ctx, source.idea.id, source.market.id);
  if (reel && !REUSABLE.includes(reel.status)) {
    throw new InvalidStateError(
      reel.status === "GENERATING"
        ? "A Reel is being made for this post."
        : `A ${reel.status} Reel gets no new video. Un-approve it first.`,
      { details: { variantId: reel.id, status: reel.status } },
    );
  }
  const created = !reel;
  if (!reel) {
    [reel] = await ctx.db
      .insert(schema.contentVariants)
      .values({
        masterIdeaId: carousel.masterIdeaId,
        marketId: carousel.marketId,
        format: "REEL",
        status: "DRAFT",
        sourceVariantId: carousel.id,
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
  const variantId = reel.id;

  const runKey = `reel-attach:${variantId}:${randomUUID()}`;
  await transitionVariant(ctx, {
    variantId,
    event: "START_PIPELINE",
    data: { runKey, attached: true },
  });
  let renderId: string | undefined;
  try {
    const [latest] = await ctx.db
      .select({ version: schema.reelScripts.version })
      .from(schema.reelScripts)
      .where(eq(schema.reelScripts.contentVariantId, variantId))
      .orderBy(desc(schema.reelScripts.version))
      .limit(1);
    const [scriptRow] = await ctx.db
      .insert(schema.reelScripts)
      .values({
        contentVariantId: variantId,
        version: (latest?.version ?? 0) + 1,
        hookOptions: script.hookOptions,
        chosenHookId: chosen.id,
        flashOpener: "OFF",
        scenes: script.scenes.map((s, index) => ({
          id: `s${index + 1}`,
          index,
          role: s.role,
          emotion: s.emotion,
          beats: s.beats,
          card: s.card,
          ...(s.line ? { line: s.line } : {}),
          ...(s.framePrompt ? { framePrompt: s.framePrompt } : {}),
          shotPrompt: s.shotPrompt,
          sourcePictureId: picture.assetId,
          layout: "FULL" as const,
          claimSlideIds: s.claimSlideIds,
        })),
        shotModel: "attached",
        costEstimateUsd: input.costUsd === undefined ? null : input.costUsd.toFixed(4),
        promptVersion: "attached",
      })
      .returning();
    if (!scriptRow) throw new Error("reel_scripts: the insert returned no row");

    const [render] = await ctx.db
      .insert(schema.reelRenders)
      .values({
        contentVariantId: variantId,
        reelScriptId: scriptRow.id,
        // The file is the whole input: the same file attached again is the same render.
        inputHash: createHash("sha256").update(`attached:${scriptRow.id}:${sha256}`).digest("hex"),
        status: "RENDERING",
        rendererVersion: "attached",
        ...(input.costUsd === undefined ? {} : { costUsd: input.costUsd.toFixed(4) }),
        triggerRunId: null,
      })
      .returning();
    if (!render) throw new Error("reel_renders: the insert returned no row");
    renderId = render.id;
    const key = `renders/reels/${variantId}/${render.id}.mp4`;
    await ctx.storage.put(key, bytes, { contentType: "video/mp4" });
    await ctx.db
      .update(schema.reelRenders)
      .set({
        status: "READY",
        width: probe.width,
        height: probe.height,
        durationMs: probe.durationMs,
        bytes: bytes.byteLength,
        sha256,
        storageKey: key,
        audioKind: probe.audioCodec ? input.audioKind : "NONE",
        qaReport: { ...qa, warnings },
        completedAt: ctx.clock.now(),
      })
      .where(eq(schema.reelRenders.id, render.id));

    await transitionVariant(ctx, {
      variantId,
      event: "PIPELINE_SUCCESS",
      set: {
        currentReelRenderId: render.id,
        pipelineState: null,
        lastError: null,
        flags: reel.flags.filter((f) => f !== "GENERATION_FAILED"),
        hook: chosen.card.replaceAll("**", ""),
        hookType: chosen.hookType,
        ...(script.post
          ? {
              caption: reelCaption(chosen, script.post.body.trim()),
              cta: script.post.cta.text,
              ctaType: script.post.cta.type,
              ctaJson: script.post.cta,
              hashtags: script.post.hashtags,
            }
          : {}),
      },
      data: { runKey, scriptId: scriptRow.id, renderId: render.id, attached: true },
    });
    await audit(ctx, {
      action: "reel.attached",
      entityType: "content_variant",
      entityId: variantId,
      marketId: reel.marketId,
      data: {
        sourceVariantId: carousel.id,
        scriptId: scriptRow.id,
        renderId: render.id,
        sha256,
        durationMs: probe.durationMs,
        created,
      },
    });
    return {
      variantId,
      created,
      scriptId: scriptRow.id,
      scriptVersion: scriptRow.version,
      renderId: render.id,
      durationMs: probe.durationMs,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The cause (a constraint, a lost connection) is what a person needs, not the failed query.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    if (renderId) {
      await ctx.db
        .update(schema.reelRenders)
        .set({
          status: "FAILED",
          error: { code: "REEL_ATTACH_FAILED", message: cause || message },
          completedAt: ctx.clock.now(),
        })
        .where(eq(schema.reelRenders.id, renderId));
    }
    // Back to a draft: nothing half-attached stays current.
    await transitionVariant(ctx, {
      variantId,
      event: "PIPELINE_FAILURE",
      set: {
        pipelineState: null,
        lastError: { code: "REEL_ATTACH_FAILED", message: cause || message },
      },
      data: { runKey, code: "REEL_ATTACH_FAILED" },
    });
    if (cause) throw new Error(`${cause} (attaching the Reel video)`, { cause: error });
    throw error;
  }
}
