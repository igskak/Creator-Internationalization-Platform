import { createHash, randomBytes } from "node:crypto";
import { schema } from "@rc/db";
import type {
  CriticReport,
  DifferentiationReport,
  GenerationConfig,
  MarketBrief,
  PipelineState,
  Slide,
  ValidationIssue,
  VariantFlag,
} from "@rc/db/json";
import { eq, inArray, sql } from "@rc/db/orm";
import { InvalidStateError, TransientError } from "@rc/lib/errors";
import type { contentWriter, critic } from "@rc/prompts";
import { countChars, registry } from "@rc/templates";
import { generationVersion, runStage, STAGE_CONFIG, type StageResult } from "../../ai";
import { audit, type ServiceContext, transition } from "../../core";
import {
  type DifferentiationVariant,
  differentiateVariants,
  type PairReport,
  slideText,
  worstReport,
} from "../../localization";
import { validateMarketBrief } from "../brief";
import { validateWriterOutput } from "../draft";
import {
  loadPipelineContext,
  type PipelineContext,
  type PipelineMarket,
  type PipelineVariant,
  p0Registry,
} from "./context";
import {
  adapterInput,
  briefValidationContext,
  criticInput,
  gistOf,
  type SiblingDraft,
  type SiblingPlan,
  validationContext,
  writerInput,
} from "./inputs";
import { buildCriticReport, decideVerdict, MAX_REWRITES, type PolicyDecision } from "./policy";
import { validateCriticOutput } from "./validate-critic";

// The variant generation pipeline for one Master Idea (plan 07 §7.6.2, M2-13): the market adapters
// one after another (later markets see the earlier plans as "do not copy"), the writers in
// parallel, validation with one repair, then the critic loop with at most two rewrites. Every
// stage stores its output and run id in the variant's `pipeline_state`, so a run that crashed
// resumes with the same `pipelineRunId` and repeats no model call that already finished.

type Brief = MarketBrief;
type Draft = contentWriter.ContentWriterOutput;
type CriticOutput = critic.CriticOutput;

export type VariantPipelineInput = {
  masterIdeaId: string;
  /** DRAFT, READY_FOR_REVIEW or CHANGES_REQUESTED variants of the idea, or ones of this run. */
  variantIds: readonly string[];
  /** Identifies the run: the same id resumes, a new one starts over. */
  pipelineRunId: string;
  /** A person's note for the writer (regenerate with instruction). */
  instruction?: string | undefined;
};

export type VariantOutcome = {
  variantId: string;
  marketCode: string;
  status: "READY_FOR_REVIEW" | "FAILED";
  verdict?: CriticReport["verdict"];
  flags: VariantFlag[];
  qualityScore?: number;
  /** Rewrites after the critic's requests (0–2). */
  rewrites: number;
  error?: { code: string; message: string };
};

export type GenerateVariantsResult = {
  pipelineRunId: string;
  outcomes: VariantOutcome[];
  /** Null when a model without a price took part. */
  costUsd: number | null;
};

const LOCKABLE = ["DRAFT", "READY_FOR_REVIEW", "CHANGES_REQUESTED"] as const;

/** A stable shuffle: the same run id gives the same order, so a resumed run plans the same way. */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0) || 1;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const newSlideId = () => randomBytes(9).toString("base64url");

type Run = {
  row: PipelineVariant;
  market: PipelineMarket;
  state: PipelineState;
  failed?: { code: string; message: string };
  brief?: Brief;
  drafts: Draft[];
  slideIds: string[];
  decision?: PolicyDecision | undefined;
  criticOutput?: CriticOutput | undefined;
  report?: DifferentiationReport | undefined;
  deterministic: ValidationIssue[];
  rewrites: number;
};

const jsonOf = (value: unknown) => JSON.stringify(value);

export async function generateVariants(
  ctx: ServiceContext,
  input: VariantPipelineInput,
): Promise<GenerateVariantsResult> {
  const { masterIdeaId, pipelineRunId } = input;
  const c = await loadPipelineContext(ctx, masterIdeaId, input.variantIds);
  const runs = await lockVariants(ctx, c, pipelineRunId);

  let costUsd: number | null = 0;
  const addCost = (cost: number | null) => {
    costUsd = costUsd === null || cost === null ? null : costUsd + cost;
  };

  /** The output of a finished stage, from the run row it was logged in. */
  const storedOutput = async <T>(runId: string): Promise<T> => {
    const [row] = await ctx.db
      .select({ output: schema.generationRuns.output })
      .from(schema.generationRuns)
      .where(eq(schema.generationRuns.id, runId));
    return row?.output as T;
  };

  const fail = async (
    run: Run,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) => {
    if (run.failed) return;
    run.failed = { code, message };
    await transition(ctx, {
      table: schema.contentVariants,
      id: run.row.id,
      from: ["GENERATING"],
      to: "DRAFT",
      set: {
        flags: ["GENERATION_FAILED"],
        lastError: { code, message, ...(details ? { details } : {}) },
        pipelineState: null,
      },
      audit: {
        action: "variant.generation_failed",
        entityType: "content_variant",
        marketId: run.row.marketId,
        data: { code, pipelineRunId },
      },
    });
  };

  /** Runs a stage once per run: a finished one is read back, a new one is logged and recorded. */
  const stage = async <T>(
    run: Run,
    key: string,
    call: () => Promise<StageResult<T>>,
    options: { soft?: boolean } = {},
  ): Promise<T | null> => {
    if (run.failed) return null;
    const done = run.state.runIds[key];
    if (run.state.completedStages.includes(key) && done) return storedOutput<T>(done);

    const result = await call();
    addCost(result.costUsd);
    await ctx.db
      .update(schema.generationRuns)
      .set({ masterIdeaId, contentVariantId: run.row.id })
      .where(inArray(schema.generationRuns.id, result.runIds));
    if (!result.data && options.soft) return null;
    if (!result.data) {
      await fail(
        run,
        result.status === "REFUSED" ? "MODEL_REFUSED" : "INVALID_OUTPUT",
        result.status === "REFUSED"
          ? `The model declined the ${key} step.`
          : `The ${key} step did not produce a valid answer.`,
        { stage: key, issues: result.issues.slice(0, 10) },
      );
      return null;
    }
    run.state = {
      ...run.state,
      stage: key,
      completedStages: [...run.state.completedStages, key],
      runIds: { ...run.state.runIds, [key]: result.runId },
    };
    await ctx.db
      .update(schema.contentVariants)
      .set({ pipelineState: run.state })
      .where(eq(schema.contentVariants.id, run.row.id));
    return result.data;
  };

  const alive = () => runs.filter((r) => !r.failed);
  const inRun = new Set(runs.map((r) => r.row.marketId));

  try {
    // --- 1. market plans, one after another ----------------------------------------------------
    const order = shuffled(runs, pipelineRunId);
    const plans: SiblingPlan[] = c.others.flatMap((o) =>
      o.marketBriefJson && !inRun.has(o.marketId)
        ? [{ marketCode: marketCodeOf(c, o), brief: o.marketBriefJson }]
        : [],
    );
    for (const run of order) {
      const siblings = plans.filter((p) => p.marketCode !== run.market.code);
      const brief = await stage<Brief>(run, "ADAPT", () =>
        runStage<Brief>(ctx, {
          stage: "MARKET_ADAPTATION",
          input: adapterInput(c, run.market, siblings),
          inputRefs: refs(c, run),
          validate: (output) =>
            validateMarketBrief(
              output,
              briefValidationContext(c, run.market, siblings, p0Registry),
            ),
        }),
      );
      if (!brief) continue;
      run.brief = brief;
      await ctx.db
        .update(schema.contentVariants)
        .set({ marketBriefJson: brief })
        .where(eq(schema.contentVariants.id, run.row.id));
      plans.push({ marketCode: run.market.code, brief });
    }

    // --- 2. drafts in parallel -----------------------------------------------------------------
    const siblingDrafts = (run: Run): SiblingDraft[] => [
      ...order
        .filter((o) => o !== run && o.drafts.at(-1))
        .map((o) => ({
          marketCode: o.market.code,
          hook: (o.drafts.at(-1) as Draft).hook,
          gist: gistOf(o.brief, (o.drafts.at(-1) as Draft).hook),
        })),
      ...c.others
        .filter((o) => o.hook && !inRun.has(o.marketId))
        .map((o) => ({
          marketCode: marketCodeOf(c, o),
          hook: o.hook ?? "",
          gist: gistOf(o.marketBriefJson, o.hook ?? ""),
        })),
    ];
    const writeDraft = async (
      run: Run,
      iteration: number,
      rewrite?: { instructions: string; previous: string },
    ) => {
      const brief = run.brief;
      if (!brief || run.failed) return;
      const draft = await stage<Draft>(run, `WRITE:${iteration}`, () =>
        runStage<Draft>(ctx, {
          stage: "CONTENT_WRITING",
          input: writerInput(c, run.market, brief, siblingDrafts(run), rewrite),
          inputRefs: refs(c, run),
          validate: (output) => validateWriterOutput(output, writerContext(c, run, brief)),
        }),
      );
      if (!draft) return;
      run.drafts[iteration] = draft;
      run.slideIds = draft.slides.map((_, i) => run.slideIds[i] ?? newSlideId());
      await ctx.db
        .update(schema.contentVariants)
        .set(draftColumns(draft, run.slideIds, brief))
        .where(eq(schema.contentVariants.id, run.row.id));
    };

    await Promise.all(
      alive().map((run) =>
        writeDraft(
          run,
          0,
          input.instruction?.trim()
            ? { instructions: input.instruction.trim(), previous: previousDraft(run) }
            : undefined,
        ),
      ),
    );

    // --- 3. critic loop: review, then at most two rewrites ----------------------------------------
    for (let iteration = 0; iteration <= MAX_REWRITES; iteration++) {
      const reviewed = alive().filter((r) => r.drafts[iteration] && r.brief);
      if (reviewed.length === 0) break;

      const pairs = await compare(ctx, c, order, alive());
      await Promise.all(
        reviewed.map(async (run) => {
          const draft = run.drafts[iteration] as Draft;
          const brief = run.brief as Brief;
          const vctx = writerContext(c, run, brief);
          run.deterministic = validateWriterOutput(draft, vctx);
          const mine = pairs.filter((p) => p.a === run.market.code || p.b === run.market.code);
          const worst = worstReport(mine);
          run.report = worst?.report;
          const later = mine.some((p) => p.report.verdict === "FAIL" && p.b === run.market.code);
          const output = await stage<CriticOutput>(
            run,
            `CRITIC:${iteration}`,
            () =>
              runStage<CriticOutput>(ctx, {
                stage: "CRITIC",
                input: criticInput(
                  c,
                  run.market,
                  brief,
                  draft,
                  siblingDrafts(run),
                  run.deterministic.map(({ code, severity, fieldPath, message }) => ({
                    code,
                    severity,
                    ...(fieldPath ? { fieldPath } : {}),
                    message,
                  })),
                  worst
                    ? {
                        verdict: worst.report.verdict,
                        hookSimilarity: worst.report.hookSimilarity,
                        slideTextSimilarity: worst.report.slideTextSimilarity,
                        reasons: worst.report.reasons,
                      }
                    : undefined,
                  iteration,
                ),
                inputRefs: refs(c, run),
                validate: (out) => validateCriticOutput(out, draft),
              }),
            // A review that cannot be had does not cost the draft: a person gets it, with a note.
            { soft: true },
          );
          if (run.failed) return;
          if (!output) return;
          run.criticOutput = output;
          run.rewrites = iteration;
          run.decision = decideVerdict({
            output,
            deterministicIssues: run.deterministic,
            ...(worst ? { differentiation: { verdict: worst.report.verdict, later } } : {}),
            citesSafetySensitive: citesSafety(c, draft),
            rewritesDone: iteration,
          });
        }),
      );

      const again = alive().filter((r) => r.decision?.verdict === "REQUEST_REWRITE");
      if (again.length === 0 || iteration === MAX_REWRITES) break;
      await Promise.all(
        again.map((run) =>
          writeDraft(run, iteration + 1, {
            instructions: (run.decision as PolicyDecision).rewriteInstructions,
            previous: jsonOf(run.drafts[iteration]),
          }),
        ),
      );
      // A variant whose rewrite failed is out; the others go to the next review.
      for (const run of again) if (!run.failed) run.decision = undefined;
    }

    // --- 4. finish ---------------------------------------------------------------------------------
    const finalPairs = await compare(ctx, c, order, alive());
    for (const run of alive()) await finish(ctx, c, run, finalPairs, pipelineRunId);
    // The other markets' drafts were compared with the old versions: bring them up to date.
    await refreshSiblings(ctx, c, finalPairs).catch((error: unknown) =>
      ctx.logger.warn({ err: error }, "could not refresh the comparison of the sibling variants"),
    );

    return {
      pipelineRunId,
      outcomes: runs.map((run) => outcomeOf(run)),
      costUsd,
    };
  } catch (error) {
    // A crash of the provider that a retry can fix leaves the run resumable; anything else ends it.
    if (!(error instanceof TransientError)) {
      for (const run of alive()) {
        await fail(run, "PIPELINE_ERROR", error instanceof Error ? error.message : String(error));
      }
    }
    throw error;
  }
}

/** Variants a refresh leaves alone: out in the world, rejected, or being written by another run. */
const NOT_REFRESHED = new Set(["GENERATING", "PUBLISHING", "PUBLISHED", "REJECTED"]);

/**
 * After a run that rewrote some markets only (a regenerated variant), the drafts of the other
 * markets still carry the comparison made against the old versions. This recomputes their report
 * and the DUPLICATION_RISK flag from the final pairs (M2-13b); nothing else of them changes.
 */
async function refreshSiblings(
  ctx: ServiceContext,
  c: PipelineContext,
  pairs: readonly PairReport[],
): Promise<void> {
  for (const other of c.others) {
    if (NOT_REFRESHED.has(other.status) || !other.hook || other.slidesJson.length === 0) continue;
    const code = marketCodeOf(c, other);
    const mine = pairs.filter((p) => p.a === code || p.b === code);
    const report = worstReport(mine)?.report;
    if (!report) continue;
    const flags: string[] = other.flags.filter((flag) => flag !== "DUPLICATION_RISK");
    if (report.verdict !== "OK") flags.push("DUPLICATION_RISK");
    const sameFlags = [...flags].sort().join() === [...other.flags].sort().join();
    if (sameFlags && JSON.stringify(report) === JSON.stringify(other.differentiationReport))
      continue;
    await ctx.db
      .update(schema.contentVariants)
      .set({ differentiationReport: report, flags })
      .where(eq(schema.contentVariants.id, other.id));
    await audit(ctx, {
      action: "variant.comparison_refreshed",
      entityType: "content_variant",
      entityId: other.id,
      marketId: other.marketId,
      data: { verdict: report.verdict, flags },
    });
  }
}

function marketCodeOf(c: PipelineContext, variant: PipelineVariant): string {
  return c.markets.get(variant.marketId)?.code ?? variant.marketId;
}

const refs = (c: PipelineContext, run: Run) => ({
  masterIdeaId: c.idea.id,
  variantId: run.row.id,
  knowledgeItemIds: c.cards.map((card) => card.id),
});

const writerContext = (c: PipelineContext, run: Run, brief: Brief) => ({
  ...validationContext(c, run.market, p0Registry),
  brief,
});

const citesSafety = (c: PipelineContext, draft: Draft): boolean => {
  const cited = new Set([
    ...draft.slides.flatMap((s) => s.knowledgeIds),
    ...draft.claimsUsed.flatMap((claim) => claim.knowledgeIds),
  ]);
  return c.cards.some((card) => card.safetySensitive && cited.has(card.id));
};

/** The draft a rewrite instruction refers to: the variant's stored draft, if it has one. */
const previousDraft = (run: Run): string =>
  run.row.hook ? jsonOf({ hook: run.row.hook, caption: run.row.caption }) : "No previous draft.";

/** Every pair of live drafts, in generation order: other markets' variants first, then this run's. */
async function compare(
  ctx: ServiceContext,
  c: PipelineContext,
  order: readonly Run[],
  live: readonly Run[],
): Promise<PairReport[]> {
  const fromRun = (run: Run): DifferentiationVariant | null => {
    const draft = run.drafts.filter(Boolean).at(-1);
    if (!draft) return null;
    return {
      marketCode: run.market.code,
      hook: draft.hook,
      hookType: draft.hookType,
      slides: draft.slides.map((s) => ({
        templateId: s.templateId,
        slots: Object.fromEntries(s.slots.map((x) => [x.slot, x.text])),
      })),
    };
  };
  const inRun = new Set(live.map((r) => r.row.marketId));
  const others: DifferentiationVariant[] = c.others
    .filter((o) => o.hook && o.slidesJson.length > 0 && !inRun.has(o.marketId))
    .map((o) => ({
      marketCode: marketCodeOf(c, o),
      hook: o.hook ?? "",
      hookType: o.hookType ?? "",
      slides: o.slidesJson.map((s) => ({ templateId: s.templateId, slots: s.slots })),
    }));
  const mine = order.filter((r) => live.includes(r)).flatMap((r) => fromRun(r) ?? []);
  return differentiateVariants(ctx.embeddings, [...others, ...mine]);
}

/** The stored columns of a draft (07 §7.7 WriterOutput → `content_variants`). */
function draftColumns(draft: Draft, slideIds: readonly string[], brief: Brief) {
  const slides: Slide[] = draft.slides.map((slide, index) => ({
    id: slideIds[index] as string,
    index,
    role: slide.role,
    templateId: slide.templateId,
    slots: Object.fromEntries(slide.slots.map((s) => [s.slot, s.text])),
    images: {},
    knowledgeIds: slide.knowledgeIds,
    factual: slide.factual,
    ...(slide.altText.trim() ? { altText: slide.altText } : {}),
  }));
  const words = slides.reduce(
    (sum, s) => sum + slideText(s.slots).split(/\s+/).filter(Boolean).length,
    0,
  );
  return {
    hook: draft.hook,
    hookType: draft.hookType,
    caption: draft.caption,
    cta: draft.cta.text,
    ctaType: draft.cta.type,
    ctaJson: draft.cta,
    hashtags: draft.hashtags,
    slidesJson: slides,
    templateSequence: slides.map((s) => s.templateId),
    contentLength: {
      slides: slides.length,
      wordsTotal: words,
      captionChars: countChars(draft.caption),
    },
    marketBriefJson: brief,
  };
}

/** `slides.2.slots.body` → `slides.<slideId>.slots.body` (04 §4.4 FieldPath grammar). */
function pathsToIds<T extends { fieldPath?: string | undefined }>(
  items: readonly T[],
  slideIds: readonly string[],
): T[] {
  return items.map((item) => {
    const match = item.fieldPath ? /^slides\.(\d+)(.*)$/.exec(item.fieldPath) : null;
    const id = match ? slideIds[Number(match[1])] : undefined;
    return match && id ? { ...item, fieldPath: `slides.${id}${match[2]}` } : item;
  });
}

async function finish(
  ctx: ServiceContext,
  c: PipelineContext,
  run: Run,
  pairs: readonly PairReport[],
  pipelineRunId: string,
): Promise<void> {
  const draft = run.drafts.filter(Boolean).at(-1);
  const brief = run.brief;
  if (!draft || !brief) return;
  const output = run.criticOutput;
  // The critic could not be consulted: the draft goes to a person with that said plainly.
  const decision: PolicyDecision =
    run.decision ??
    ({
      verdict: "FLAG_FOR_HUMAN",
      reasons: ["The automatic review did not run."],
      flags: citesSafety(c, draft) ? ["SAFETY_REVIEW"] : [],
      qualityScore: 0,
      rewriteInstructions: "",
      humanAttention: "The automatic review failed; read the draft closely before approving.",
    } satisfies PolicyDecision);

  const mine = pairs.filter((p) => p.a === run.market.code || p.b === run.market.code);
  const report = worstReport(mine)?.report ?? run.report;
  const reportWithIds = (r: CriticReport): CriticReport => ({
    ...r,
    unsupportedClaims: pathsToIds(r.unsupportedClaims, run.slideIds),
    issues: pathsToIds(r.issues, run.slideIds),
    deterministicIssues: pathsToIds(r.deterministicIssues, run.slideIds),
  });
  const criticReport = output
    ? reportWithIds(buildCriticReport(output, decision, run.deterministic, run.rewrites))
    : undefined;
  // The duplication flag follows the final comparison: a later rewrite may have cleared the risk.
  const flags: VariantFlag[] = [...new Set(decision.flags)].filter(
    (flag) => flag !== "DUPLICATION_RISK",
  );
  if (report && report.verdict !== "OK") flags.push("DUPLICATION_RISK");

  await transition(ctx, {
    table: schema.contentVariants,
    id: run.row.id,
    from: ["GENERATING"],
    to: "READY_FOR_REVIEW",
    set: {
      ...draftColumns(draft, run.slideIds, brief),
      offerId: c.offers.get(run.market.id)?.id ?? null,
      flags,
      criticVerdict: decision.verdict,
      criticReport: criticReport ?? null,
      qualityScore: output ? decision.qualityScore.toFixed(2) : null,
      differentiationReport: report ?? null,
      generationVersion: generationVersion(),
      generationConfig: generationConfig(ctx),
      pipelineState: { ...run.state, stage: "DONE" },
      lastError: null,
      lockVersion: sql`${schema.contentVariants.lockVersion} + 1`,
    },
    audit: {
      action: "variant.generated",
      entityType: "content_variant",
      marketId: run.row.marketId,
      data: { pipelineRunId, verdict: decision.verdict, rewrites: run.rewrites, flags },
    },
  });
  run.decision = { ...decision, flags };
}

function generationConfig(ctx: ServiceContext): GenerationConfig {
  const stages = Object.fromEntries(
    (["MARKET_ADAPTATION", "CONTENT_WRITING", "CRITIC"] as const).map((name) => {
      const config = STAGE_CONFIG[name];
      return [
        name,
        {
          promptId: config.promptId,
          promptVersion: config.version,
          model: config.model,
          effort: config.effort,
        },
      ];
    }),
  );
  return {
    pipelineVersion: generationVersion().slice(1),
    stages,
    templatesVersion: registry.version({ priority: "P0" }),
    embeddingModel: ctx.embeddings.model,
  };
}

function outcomeOf(run: Run): VariantOutcome {
  const base = { variantId: run.row.id, marketCode: run.market.code, rewrites: run.rewrites };
  if (run.failed)
    return { ...base, status: "FAILED", flags: ["GENERATION_FAILED"], error: run.failed };
  return {
    ...base,
    status: "READY_FOR_REVIEW",
    flags: (run.decision?.flags ?? []) as VariantFlag[],
    ...(run.decision
      ? {
          verdict: run.decision.verdict,
          ...(run.criticOutput ? { qualityScore: run.decision.qualityScore } : {}),
        }
      : {}),
  };
}

/**
 * Takes the variants for this run (07 §7.6.2, J5 step 1): DRAFT, READY_FOR_REVIEW and
 * CHANGES_REQUESTED ones become GENERATING with a fresh `pipeline_state`; one that is already
 * GENERATING for this same run is resumed; one that another run is working on stops everything
 * before any variant is touched.
 */
async function lockVariants(
  ctx: ServiceContext,
  c: PipelineContext,
  pipelineRunId: string,
): Promise<Run[]> {
  const busy = c.variants.filter(
    (v) => v.status === "GENERATING" && v.pipelineState?.pipelineRunId !== pipelineRunId,
  );
  if (busy.length > 0) {
    throw new InvalidStateError("Another generation run is already working on these variants.", {
      details: { variantIds: busy.map((v) => v.id) },
    });
  }
  const runs: Run[] = [];
  for (const row of c.variants) {
    const market = c.markets.get(row.marketId) as PipelineMarket;
    if (row.status === "GENERATING") {
      const state = row.pipelineState as PipelineState;
      runs.push({
        row,
        market,
        state,
        drafts: [],
        slideIds: row.slidesJson.map((s) => s.id),
        deterministic: [],
        rewrites: 0,
      });
      continue;
    }
    const state: PipelineState = {
      pipelineRunId,
      stage: "START",
      startedAt: ctx.clock.now().toISOString(),
      completedStages: [],
      runIds: {},
    };
    const locked = await transition(ctx, {
      table: schema.contentVariants,
      id: row.id,
      from: LOCKABLE,
      to: "GENERATING",
      set: { pipelineState: state, flags: [], lastError: null },
      audit: {
        action: "variant.generation_started",
        entityType: "content_variant",
        marketId: row.marketId,
        data: { pipelineRunId, from: row.status },
      },
    });
    runs.push({
      row: locked,
      market,
      state,
      drafts: [],
      slideIds: row.slidesJson.map((s) => s.id),
      deterministic: [],
      rewrites: 0,
    });
  }
  return runs;
}
