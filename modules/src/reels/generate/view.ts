import { schema } from "@rc/db";
import type { ReelHookOption } from "@rc/db/json";
import { and, desc, eq, inArray, ne, or, sql } from "@rc/db/orm";
import { InvalidStateError } from "@rc/lib/errors";
import { VIDEO_MODELS, type VideoModelId } from "@rc/lib/providers/video";
import { type AllowedAction, allowedActions, reelReviewFacts } from "../../content";
import type { ServiceContext } from "../../core";
import { reelsEnabled } from "./enabled";
import { estimateReel, type ReelEstimate } from "./estimate";
import { loadReelSource } from "./source";

// What the Reel card of a market shows (plan 18 §18.2, M8-07): whether a Reel can be requested and
// why not, what it would cost on each model, and, once there is a Reel, its stage, script, shots,
// video and cost. Plain data: it goes straight to the client.

const PLAY_URL_SECONDS = 60 * 60;
/**
 * The reviewer actions a Reel offers (M8-09): the carousel's editing actions do not apply (a Reel is
 * changed by a new hook or a redone shot), the decisions and the publishing ones do.
 */
const REEL_ACTIONS: readonly AllowedAction["action"][] = [
  "approve",
  "requestChanges",
  "resubmit",
  "reject",
  "unapprove",
  "schedule",
  "cancelSchedule",
  "publishNow",
  "retry",
];

/** A Reel in these states can be changed (the same states `requestReel` accepts). */
const CHANGEABLE: readonly string[] = ["DRAFT", "READY_FOR_REVIEW", "CHANGES_REQUESTED"];

export type ReelBlock =
  | "reels_disabled"
  | "carousel_not_ready"
  | "no_pictures"
  | "reel_generating"
  | "reel_in_use";

export type ReelSceneView = {
  id: string;
  index: number;
  role: string;
  emotion: string;
  beats: number;
  card: string;
  shotPrompt: string;
  shotAttempt: number;
  /** State of the scene's shot; null before the shot exists. */
  shot: "PENDING" | "RUNNING" | "READY" | "FAILED" | "BLOCKED" | null;
  shotCostUsd: number | null;
};

export type ReelRenderView = {
  state: "NONE" | "RENDERING" | "READY" | "STALE" | "FAILED";
  renderId: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  warnings: string[];
  playUrl: string | null;
  downloadUrl: string | null;
  error: string | null;
};

export type ReelDetail = {
  variantId: string;
  status: string;
  /** Optimistic lock of the Reel variant (approve sends it back). */
  lockVersion: number;
  /** What the reviewer can do now, with what blocks it (the same rules as a carousel's). */
  allowed: AllowedAction[];
  flags: string[];
  lastError: { code: string; message: string } | null;
  /** Where a running generation is; null when none runs. */
  stage: {
    current: "DIRECTION" | "SHOTS" | "ASSEMBLY";
    completed: string[];
    shotsReady: number;
    shotsTotal: number | null;
    startedAt: string;
  } | null;
  script: {
    id: string;
    version: number;
    model: string;
    chosenHookId: string | null;
    hookOptions: ReelHookOption[];
    flashOpener: "ON" | "OFF";
    scenes: ReelSceneView[];
  } | null;
  render: ReelRenderView;
  /** Director plus shots of every run, list-price estimates (USD); null when nothing was recorded. */
  costUsd: number | null;
  /** The Reel can be changed (hook, one shot) or generated again. */
  changeable: boolean;
  /** A trial Reel (M8-11): how it graduates; null = a normal Reel. */
  trialGraduation: "MANUAL" | "SS_PERFORMANCE" | null;
  /** What the Reel posts with: its caption, ask and hashtags (reel-director@2 writes its own). */
  post: { caption: string; cta: { type: string; text: string }; hashtags: string[] };
};

export type ReelView = {
  carouselVariantId: string;
  enabled: boolean;
  blockedBy: ReelBlock | null;
  estimates: Record<VideoModelId, ReelEstimate>;
  reel: ReelDetail | null;
};

const slug = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[^\w\s-]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, "-")
    .slice(0, 40) || "reel";

export function reelEstimates(): Record<VideoModelId, ReelEstimate> {
  return Object.fromEntries(
    VIDEO_MODELS.map((model) => [model, estimateReel({ model })]),
  ) as Record<VideoModelId, ReelEstimate>;
}

async function detailOf(
  ctx: ServiceContext,
  reel: typeof schema.contentVariants.$inferSelect,
  names: { marketCode: string; topic: string },
): Promise<ReelDetail> {
  const [script] = await ctx.db
    .select()
    .from(schema.reelScripts)
    .where(eq(schema.reelScripts.contentVariantId, reel.id))
    .orderBy(desc(schema.reelScripts.version))
    .limit(1);

  // Shots of the scenes, by id.
  const shotIds = (script?.scenes ?? []).flatMap((s) => (s.shotId ? [s.shotId] : []));
  const shotRows = shotIds.length
    ? await ctx.db.select().from(schema.reelShots).where(inArray(schema.reelShots.id, shotIds))
    : [];
  const shotById = new Map(shotRows.map((s) => [s.id, s]));

  const [current] = reel.currentReelRenderId
    ? await ctx.db
        .select()
        .from(schema.reelRenders)
        .where(eq(schema.reelRenders.id, reel.currentReelRenderId))
    : [];
  const [latest] = await ctx.db
    .select()
    .from(schema.reelRenders)
    .where(eq(schema.reelRenders.contentVariantId, reel.id))
    .orderBy(desc(schema.reelRenders.createdAt))
    .limit(1);
  const generating = reel.status === "GENERATING";
  let render: ReelRenderView = {
    state: generating ? "RENDERING" : "NONE",
    renderId: null,
    durationMs: null,
    width: null,
    height: null,
    bytes: null,
    warnings: [],
    playUrl: null,
    downloadUrl: null,
    error: null,
  };
  if (current?.status === "READY" && current.storageKey) {
    const fileName = `reel-${slug(names.marketCode)}-${slug(names.topic)}.mp4`;
    const [play, download] = await Promise.all([
      ctx.storage.presignGet(current.storageKey, { expiresInSeconds: PLAY_URL_SECONDS }),
      ctx.storage.presignGet(current.storageKey, {
        expiresInSeconds: PLAY_URL_SECONDS,
        downloadFileName: fileName,
      }),
    ]);
    render = {
      state: generating
        ? "RENDERING"
        : script && current.reelScriptId !== script.id
          ? "STALE"
          : "READY",
      renderId: current.id,
      durationMs: current.durationMs,
      width: current.width,
      height: current.height,
      bytes: current.bytes,
      warnings: current.qaReport?.warnings ?? [],
      playUrl: play.url,
      downloadUrl: download.url,
      error: null,
    };
  } else if (!generating && latest?.status === "FAILED") {
    render = { ...render, state: "FAILED", error: latest.error?.message ?? null };
  }

  const [cost] = await ctx.db
    .select({ total: sql<string | null>`sum(${schema.generationRuns.costUsd})` })
    .from(schema.generationRuns)
    .where(
      or(
        eq(schema.generationRuns.contentVariantId, reel.id),
        inArray(
          schema.generationRuns.id,
          sql`(select ${schema.reelScripts.generationRunId} from ${schema.reelScripts} where ${schema.reelScripts.contentVariantId} = ${reel.id} and ${schema.reelScripts.generationRunId} is not null)`,
        ),
      ),
    );

  const state = reel.pipelineState;
  const { facts } = await reelReviewFacts(ctx, reel);
  const role = ctx.actor.type === "USER" ? ctx.actor.role : undefined;
  return {
    variantId: reel.id,
    status: reel.status,
    trialGraduation: reel.trialGraduation ?? null,
    post: {
      caption: reel.caption ?? "",
      cta: { type: reel.ctaType ?? "NONE", text: reel.cta ?? "" },
      hashtags: reel.hashtags,
    },
    lockVersion: reel.lockVersion,
    allowed: allowedActions(facts, role).filter((a) => REEL_ACTIONS.includes(a.action)),
    flags: reel.flags,
    lastError: reel.lastError
      ? { code: reel.lastError.code, message: reel.lastError.message }
      : null,
    stage:
      generating && state
        ? {
            current: state.stage as "DIRECTION" | "SHOTS" | "ASSEMBLY",
            completed: state.completedStages,
            shotsReady: Number(state.runIds.SHOTS_READY ?? 0),
            shotsTotal: script?.scenes.length ?? null,
            startedAt: state.startedAt,
          }
        : null,
    script: script
      ? {
          id: script.id,
          version: script.version,
          model: script.shotModel,
          chosenHookId: script.chosenHookId,
          hookOptions: script.hookOptions,
          flashOpener: script.flashOpener,
          scenes: script.scenes.map((s) => {
            const shot = s.shotId ? shotById.get(s.shotId) : undefined;
            return {
              id: s.id,
              index: s.index,
              role: s.role,
              emotion: s.emotion,
              beats: s.beats,
              card: s.card,
              shotPrompt: s.shotPrompt,
              shotAttempt: s.shotAttempt ?? 0,
              shot: shot?.status ?? null,
              shotCostUsd: shot?.costUsd == null ? null : Number(shot.costUsd),
            };
          }),
        }
      : null,
    render,
    costUsd: cost?.total == null ? null : Math.round(Number(cost.total) * 10_000) / 10_000,
    changeable: CHANGEABLE.includes(reel.status),
  };
}

/** The Reel card data of one carousel (one market's draft). */
export async function getReelView(
  ctx: ServiceContext,
  carouselVariantId: string,
): Promise<ReelView> {
  const enabled = await reelsEnabled(ctx);
  const estimates = reelEstimates();
  let blockedBy: ReelBlock | null = null;
  let reel: typeof schema.contentVariants.$inferSelect | undefined;
  let names = { marketCode: "", topic: "" };
  try {
    const source = await loadReelSource(ctx, carouselVariantId);
    names = { marketCode: source.market.code, topic: "" };
    [reel] = await ctx.db
      .select()
      .from(schema.contentVariants)
      .where(
        and(
          eq(schema.contentVariants.masterIdeaId, source.carousel.masterIdeaId),
          eq(schema.contentVariants.marketId, source.carousel.marketId),
          eq(schema.contentVariants.format, "REEL"),
          ne(schema.contentVariants.status, "REJECTED"),
        ),
      );
    const [idea] = await ctx.db
      .select({ topic: schema.masterIdeas.topic })
      .from(schema.masterIdeas)
      .where(eq(schema.masterIdeas.id, source.idea.id));
    names.topic = idea?.topic ?? "";
  } catch (error) {
    const code = (error as { details?: { code?: string } } | null)?.details?.code;
    if (
      error instanceof InvalidStateError &&
      (code === "carousel_not_ready" || code === "no_pictures")
    ) {
      blockedBy = code;
    } else {
      throw error;
    }
  }
  if (!blockedBy) {
    blockedBy = !enabled
      ? "reels_disabled"
      : reel?.status === "GENERATING"
        ? "reel_generating"
        : reel && !CHANGEABLE.includes(reel.status)
          ? "reel_in_use"
          : null;
  }
  return {
    carouselVariantId,
    enabled,
    blockedBy,
    estimates,
    reel: reel ? await detailOf(ctx, reel, names) : null,
  };
}

/** The Reel cards of several carousels, by carousel id. */
export async function getReelViews(
  ctx: ServiceContext,
  carouselVariantIds: readonly string[],
): Promise<Record<string, ReelView>> {
  const entries = await Promise.all(
    carouselVariantIds.map(async (id) => [id, await getReelView(ctx, id)] as const),
  );
  return Object.fromEntries(entries);
}
