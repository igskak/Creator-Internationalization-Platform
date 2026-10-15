import { schema } from "@rc/db";
import { and, desc, eq, inArray, sql } from "@rc/db/orm";
import type { ServiceContext } from "../../core";

// Progress of long actions on the review screen (plan 15 M6-10): where a market's draft is, read
// from the rows the pipeline already writes (`pipeline_state`, `visual_assets`, `carousel_renders`),
// never an invented percentage. The page and a 3-second poll use the same read: one query per
// idea, because the session pooler has only 15 client slots (decision log 2026-10-12).

export const PROGRESS_STEPS = ["ADAPT", "WRITE", "CRITIC", "VISUAL", "PICTURES", "RENDER"] as const;
export type ProgressStepKey = (typeof PROGRESS_STEPS)[number];
export type StepState = "done" | "current" | "todo" | "failed";

export type ProgressStep = {
  key: ProgressStepKey;
  state: StepState;
  /** Pictures made so far, when the step is the pictures. */
  count?: { done: number; total: number };
  /** The critic is looking at the Nth rewrite of the text. */
  rewrite?: number;
};

export type ProgressPhase = "queued" | "running" | "failed" | "idle";

export type DraftProgress = {
  variantId: string;
  marketCode: string;
  /** The variant's status; the page compares it with the one it shows. */
  status: string;
  phase: ProgressPhase;
  steps: ProgressStep[];
  /** When the running work began (ISO), null while it only waits. */
  startedAt: string | null;
  /** When something last moved (ISO): the base of the "taking longer than usual" state. */
  lastProgressAt: string | null;
  /** Running, but nothing has moved for `STALL_AFTER_MS`. */
  stalled: boolean;
  error: { code: string; message: string } | null;
};

/** A draft, its pictures and its render that show no movement for this long are "stalled". */
export const STALL_AFTER_MS = 10 * 60_000;
/** A run older than this is a leftover of a crashed job, not something running (the header ignores it). */
const GHOST_AFTER_MS = 2 * 60 * 60_000;

export type ProgressFacts = {
  variantId: string;
  marketCode: string;
  status: string;
  hasContent: boolean;
  pipeline: { startedAt: string; updatedAt?: string | undefined; completedStages: string[] } | null;
  /** The variant row's own `updated_at` (ms since the epoch). */
  variantUpdatedAt: number;
  lastError: { code: string; message: string; details?: { stage?: string } } | null;
  pictures: { pending: number; ready: number; firstAt: number | null; lastAt: number | null };
  /** The newest render and whether the variant's current render is a finished one. */
  render: {
    status: "PENDING" | "RENDERING" | "READY" | "FAILED" | null;
    at: number | null;
    error: string | null;
    currentIsReady: boolean;
  };
};

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** The steps of the text pipeline that are finished, from the stage keys the pipeline stored. */
function textStepsDone(completed: readonly string[]) {
  const writes = completed
    .filter((key) => key.startsWith("WRITE:"))
    .map((key) => Number(key.slice("WRITE:".length)))
    .filter(Number.isInteger);
  const lastWrite = writes.length > 0 ? Math.max(...writes) : -1;
  return {
    done: {
      ADAPT: completed.includes("ADAPT"),
      WRITE: lastWrite >= 0,
      CRITIC: lastWrite >= 0 && completed.includes(`CRITIC:${lastWrite}`),
      VISUAL: completed.includes("VISUAL"),
    },
    rewrite: Math.max(lastWrite, 0),
  };
}

const TEXT_STEPS = ["ADAPT", "WRITE", "CRITIC", "VISUAL"] as const;
const LATER_STEPS = ["PICTURES", "RENDER"] as const;

/** Marks the steps before `index` done, the one at `index` as `at`, the rest to come. */
function stepsAround(index: number, at: StepState): ProgressStep[] {
  return PROGRESS_STEPS.map((key, i) => ({
    key,
    state: i < index ? "done" : i === index ? at : "todo",
  }));
}

/** Where one market's draft is, from the facts read for it. Pure: `now` is in ms. */
export function buildDraftProgress(facts: ProgressFacts, now: number): DraftProgress {
  const base = {
    variantId: facts.variantId,
    marketCode: facts.marketCode,
    status: facts.status,
  };
  const idle: DraftProgress = {
    ...base,
    phase: "idle",
    steps: stepsAround(PROGRESS_STEPS.length, "done"),
    startedAt: null,
    lastProgressAt: null,
    stalled: false,
    error: null,
  };
  const running = (
    steps: ProgressStep[],
    startedAt: number | null,
    lastAt: number,
  ): DraftProgress => ({
    ...base,
    phase: "running",
    steps,
    startedAt: iso(startedAt),
    lastProgressAt: iso(lastAt),
    stalled: now - lastAt > STALL_AFTER_MS,
    error: null,
  });

  const queued = facts.status === "DRAFT" && !facts.hasContent && !facts.lastError;
  if (queued) {
    return {
      ...idle,
      phase: "queued",
      steps: stepsAround(0, "todo"),
      lastProgressAt: iso(facts.variantUpdatedAt),
      // A job that never starts looks the same as a queue: after the limit, say so.
      stalled: now - facts.variantUpdatedAt > STALL_AFTER_MS,
    };
  }

  if (facts.status === "GENERATING") {
    const completed = facts.pipeline?.completedStages ?? [];
    const { done, rewrite } = textStepsDone(completed);
    const current = TEXT_STEPS.findIndex((key) => !done[key]);
    const steps = stepsAround(current === -1 ? TEXT_STEPS.length : current, "current").map(
      (step) => {
        if (step.key === "CRITIC" && step.state === "current" && rewrite > 0) {
          return { ...step, rewrite };
        }
        return step;
      },
    );
    const started = facts.pipeline ? Date.parse(facts.pipeline.startedAt) : null;
    const last = facts.pipeline?.updatedAt
      ? Date.parse(facts.pipeline.updatedAt)
      : (started ?? facts.variantUpdatedAt);
    return running(steps, started, last);
  }

  if (!facts.hasContent) {
    // The pipeline gave up: the stage that failed is in the stored error.
    const failedKey = facts.lastError?.details?.stage?.split(":")[0];
    const mapped = Math.max(
      TEXT_STEPS.findIndex((key) => key === failedKey),
      0,
    );
    return {
      ...idle,
      phase: "failed",
      steps: stepsAround(mapped, "failed"),
      error: facts.lastError
        ? { code: facts.lastError.code, message: facts.lastError.message }
        : null,
    };
  }

  // The text exists: pictures are made, then the slides are rendered.
  if (facts.pictures.pending > 0) {
    const total = facts.pictures.pending + facts.pictures.ready;
    const steps = stepsAround(TEXT_STEPS.length, "current").map((step) =>
      step.key === "PICTURES" ? { ...step, count: { done: facts.pictures.ready, total } } : step,
    );
    return running(steps, facts.pictures.firstAt, facts.pictures.lastAt ?? facts.variantUpdatedAt);
  }
  const { render } = facts;
  if (render.status === "PENDING" || render.status === "RENDERING") {
    return running(
      stepsAround(TEXT_STEPS.length + LATER_STEPS.indexOf("RENDER"), "current"),
      render.at,
      render.at ?? facts.variantUpdatedAt,
    );
  }
  if (render.status === "FAILED" && !render.currentIsReady) {
    return {
      ...idle,
      phase: "failed",
      steps: stepsAround(PROGRESS_STEPS.indexOf("RENDER"), "failed"),
      error: {
        code: "RENDER_FAILED",
        message: render.error ?? "The slides could not be rendered.",
      },
    };
  }
  return idle;
}

/** Progress of every carousel draft of one idea, for the review page and its poll. */
export async function getDraftProgress(
  ctx: ServiceContext,
  ideaId: string,
): Promise<DraftProgress[]> {
  const cv = schema.contentVariants;
  const ms = (column: ReturnType<typeof sql>) =>
    sql<number | null>`(extract(epoch from ${column}) * 1000)::double precision`;
  const rows = await ctx.db
    .select({
      id: cv.id,
      marketCode: schema.markets.code,
      status: cv.status,
      slideCount: sql<number>`jsonb_array_length(${cv.slidesJson})::int`,
      pipelineState: cv.pipelineState,
      lastError: cv.lastError,
      updatedAt: ms(sql`${cv.updatedAt}`),
      picturesPending: sql<number>`(select count(*)::int from visual_assets a where a.content_variant_id = ${cv.id} and a.kind = 'GENERATED' and a.status = 'PENDING')`,
      picturesReady: sql<number>`(select count(*)::int from visual_assets a where a.content_variant_id = ${cv.id} and a.kind = 'GENERATED' and a.status = 'READY')`,
      picturesFirstAt: ms(
        sql`(select min(a.created_at) from visual_assets a where a.content_variant_id = ${cv.id} and a.kind = 'GENERATED' and a.status = 'PENDING')`,
      ),
      picturesLastAt: ms(
        sql`(select max(a.updated_at) from visual_assets a where a.content_variant_id = ${cv.id} and a.kind = 'GENERATED')`,
      ),
      renderStatus: sql<
        "PENDING" | "RENDERING" | "READY" | "FAILED" | null
      >`(select r.status::text from carousel_renders r where r.content_variant_id = ${cv.id} order by r.created_at desc limit 1)`,
      renderAt: ms(
        sql`(select r.created_at from carousel_renders r where r.content_variant_id = ${cv.id} order by r.created_at desc limit 1)`,
      ),
      renderError: sql<
        string | null
      >`(select r.error->>'message' from carousel_renders r where r.content_variant_id = ${cv.id} order by r.created_at desc limit 1)`,
      currentRenderReady: sql<boolean>`coalesce((select r.status = 'READY' from carousel_renders r where r.id = ${cv.currentRenderId}), false)`,
    })
    .from(cv)
    .innerJoin(schema.markets, eq(schema.markets.id, cv.marketId))
    .where(and(eq(cv.masterIdeaId, ideaId), eq(cv.format, "CAROUSEL")))
    .orderBy(schema.markets.sortOrder, schema.markets.code);

  const now = ctx.clock.now().getTime();
  return rows
    .filter((row) => row.status !== "REJECTED")
    .map((row) =>
      buildDraftProgress(
        {
          variantId: row.id,
          marketCode: row.marketCode,
          status: row.status,
          hasContent: row.slideCount > 0,
          pipeline: row.pipelineState,
          variantUpdatedAt: Number(row.updatedAt ?? now),
          lastError: row.lastError as ProgressFacts["lastError"],
          pictures: {
            pending: Number(row.picturesPending),
            ready: Number(row.picturesReady),
            firstAt: row.picturesFirstAt === null ? null : Number(row.picturesFirstAt),
            lastAt: row.picturesLastAt === null ? null : Number(row.picturesLastAt),
          },
          render: {
            status: row.renderStatus,
            at: row.renderAt === null ? null : Number(row.renderAt),
            error: row.renderError,
            currentIsReady: Boolean(row.currentRenderReady),
          },
        },
        now,
      ),
    );
}

/** How many drafts, Reels and renders are being made right now (the header's indicator). */
export async function getActivity(ctx: ServiceContext): Promise<{ running: number }> {
  const since = new Date(ctx.clock.now().getTime() - GHOST_AFTER_MS).toISOString();
  const [drafts] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.contentVariants)
    .where(
      and(
        eq(schema.contentVariants.status, "GENERATING"),
        sql`coalesce(${schema.contentVariants.pipelineState}->>'startedAt', ${schema.contentVariants.updatedAt}::text) >= ${since}`,
      ),
    );
  const [renders] = await ctx.db
    .select({ n: sql<number>`count(distinct ${schema.carouselRenders.contentVariantId})::int` })
    .from(schema.carouselRenders)
    .where(
      and(
        inArray(schema.carouselRenders.status, ["PENDING", "RENDERING"]),
        sql`${schema.carouselRenders.createdAt} >= ${since}::timestamptz`,
      ),
    );
  return { running: Number(drafts?.n ?? 0) + Number(renders?.n ?? 0) };
}

/**
 * The usual time of a draft run in ms: the median of the last 20 finished runs (the audit event of
 * a finished run carries its duration), null until there are three.
 */
export async function usualDraftDurationMs(ctx: ServiceContext): Promise<number | null> {
  const rows = await ctx.db
    .select({
      durationMs: sql<number | null>`(${schema.auditEvents.data}->>'durationMs')::double precision`,
    })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.action, "variant.generated"))
    .orderBy(desc(schema.auditEvents.id))
    .limit(20);
  const values = rows
    .map((r) => (r.durationMs === null ? NaN : Number(r.durationMs)))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (values.length < 3) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[mid] as number)
    : ((values[mid - 1] as number) + (values[mid] as number)) / 2;
}
