import { schema } from "@rc/db";
import { EXPERIMENT_DIMENSIONS, type VisualHypothesis } from "@rc/db/json";
import { and, desc, eq, inArray, isNotNull } from "@rc/db/orm";
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext } from "../../core";
import { mannWhitneyU } from "./stats";

// Experiments-lite (plan 11 §11.6, M7-06): two arms of one dimension in one market, variants put
// into an arm by hand on the review screen, results from the D7 numbers once both arms have the
// minimum of posts. Completing an experiment about a visual style can confirm or reject the
// market's visual hypothesis, which is how a market's visual rules become durable only after data
// [S§8.2].

export const EXPERIMENT_STATUSES = ["DRAFT", "RUNNING", "COMPLETED", "CANCELLED"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
/** Who may move to what (DRAFT → RUNNING → COMPLETED; DRAFT or RUNNING → CANCELLED). */
const NEXT: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  DRAFT: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const parseInput = <S extends z.ZodType>(zod: S, raw: unknown): z.output<S> => {
  const parsed = zod.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
};
const requireEditor = (ctx: ServiceContext) => {
  if (ctx.actor.type === "USER" && ctx.actor.role === "chef") throw new ForbiddenError();
};

const Code = z.string().trim().min(1).max(100);

export const UpsertExperimentInput = z
  .object({
    /** Absent: a new experiment. Only a DRAFT can be changed. */
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(120),
    hypothesis: z.string().trim().min(1).max(1000),
    marketId: z.uuid(),
    dimension: z.enum(EXPERIMENT_DIMENSIONS),
    variantA: Code,
    variantB: Code,
    primaryMetric: z.enum(["save_rate", "share_rate"]).default("save_rate"),
    minPostsPerArm: z.number().int().min(2).max(100).default(5),
    notes: z.string().trim().max(2000).optional(),
    /** A visual hypothesis of the market (`visual_style` experiments only). */
    visualHypothesisId: z.string().trim().min(1).max(100).optional(),
  })
  .superRefine((v, issue) => {
    if (v.variantA === v.variantB) {
      issue.addIssue({ code: "custom", path: ["variantB"], message: "The two arms must differ." });
    }
    if (v.visualHypothesisId && v.dimension !== "visual_style") {
      issue.addIssue({
        code: "custom",
        path: ["visualHypothesisId"],
        message: "Only an experiment about the visual style can test a visual hypothesis.",
      });
    }
  });

export type ExperimentRow = typeof schema.experiments.$inferSelect;

async function loadExperiment(ctx: ServiceContext, id: string): Promise<ExperimentRow> {
  const [row] = await ctx.db.select().from(schema.experiments).where(eq(schema.experiments.id, id));
  if (!row) throw new NotFoundError("Experiment not found.", { details: { id } });
  return row;
}

async function marketHypotheses(
  ctx: ServiceContext,
  marketId: string,
): Promise<VisualHypothesis[]> {
  const [market] = await ctx.db
    .select({ hypotheses: schema.markets.visualHypotheses })
    .from(schema.markets)
    .where(eq(schema.markets.id, marketId));
  if (!market)
    throw new ValidationError("Unknown market.", {
      fieldErrors: { marketId: ["Unknown market."] },
    });
  return market.hypotheses ?? [];
}

async function setHypothesisStatus(
  ctx: ServiceContext,
  marketId: string,
  hypothesisId: string,
  status: VisualHypothesis["status"],
): Promise<void> {
  const hypotheses = await marketHypotheses(ctx, marketId);
  if (!hypotheses.some((h) => h.id === hypothesisId)) return;
  await ctx.db
    .update(schema.markets)
    .set({
      visualHypotheses: hypotheses.map((h) => (h.id === hypothesisId ? { ...h, status } : h)),
    })
    .where(eq(schema.markets.id, marketId));
  await audit(ctx, {
    action: "market.visual_hypothesis_status",
    entityType: "market",
    entityId: marketId,
    marketId,
    data: { hypothesisId, status },
  });
}

export async function upsertExperiment(
  ctx: ServiceContext,
  raw: z.input<typeof UpsertExperimentInput>,
): Promise<ExperimentRow> {
  requireEditor(ctx);
  const input = parseInput(UpsertExperimentInput, raw);
  if (input.visualHypothesisId) {
    const hypotheses = await marketHypotheses(ctx, input.marketId);
    if (!hypotheses.some((h) => h.id === input.visualHypothesisId)) {
      throw new ValidationError("The market has no such visual hypothesis.", {
        fieldErrors: { visualHypothesisId: ["The market has no such visual hypothesis."] },
      });
    }
  } else {
    await marketHypotheses(ctx, input.marketId);
  }
  const values = {
    name: input.name,
    hypothesis: input.hypothesis,
    marketId: input.marketId,
    dimension: input.dimension,
    variantA: input.variantA,
    variantB: input.variantB,
    primaryMetric: input.primaryMetric,
    minPostsPerArm: input.minPostsPerArm,
    notes: input.notes ?? null,
    visualHypothesisId: input.visualHypothesisId ?? null,
  };
  if (input.id) {
    const current = await loadExperiment(ctx, input.id);
    if (current.status !== "DRAFT") {
      throw new InvalidStateError("Only a draft experiment can be changed.", {
        details: { status: current.status },
      });
    }
    const [row] = await ctx.db
      .update(schema.experiments)
      .set(values)
      .where(eq(schema.experiments.id, input.id))
      .returning();
    await audit(ctx, {
      action: "experiment.updated",
      entityType: "experiment",
      entityId: input.id,
    });
    return row as ExperimentRow;
  }
  const [row] = await ctx.db
    .insert(schema.experiments)
    .values({ ...values, createdBy: ctx.actor.type === "USER" ? ctx.actor.userId : null })
    .returning();
  if (!row) throw new Error("experiment: insert returned no row");
  await audit(ctx, {
    action: "experiment.created",
    entityType: "experiment",
    entityId: row.id,
    ...(row.marketId ? { marketId: row.marketId } : {}),
    data: { dimension: row.dimension, a: row.variantA, b: row.variantB },
  });
  return row;
}

export const SetExperimentStatusInput = z.object({
  id: z.uuid(),
  status: z.enum(["RUNNING", "COMPLETED", "CANCELLED"]),
  /** On completion of an experiment with a visual hypothesis: what the data said. */
  outcome: z.enum(["CONFIRMED", "REJECTED", "INCONCLUSIVE"]).optional(),
});

export async function setExperimentStatus(
  ctx: ServiceContext,
  raw: z.input<typeof SetExperimentStatusInput>,
): Promise<ExperimentRow> {
  requireEditor(ctx);
  const input = parseInput(SetExperimentStatusInput, raw);
  const current = await loadExperiment(ctx, input.id);
  if (!NEXT[current.status].includes(input.status)) {
    throw new InvalidStateError(`A ${current.status} experiment cannot become ${input.status}.`, {
      details: { from: current.status, to: input.status },
    });
  }
  const now = ctx.clock.now();
  const [row] = await ctx.db
    .update(schema.experiments)
    .set({
      status: input.status,
      ...(input.status === "RUNNING" ? { startAt: now } : { endAt: now }),
    })
    .where(and(eq(schema.experiments.id, input.id), eq(schema.experiments.status, current.status)))
    .returning();
  if (!row) throw new InvalidStateError("The experiment changed meanwhile; reload.");
  if (current.visualHypothesisId && current.marketId) {
    if (input.status === "RUNNING") {
      await setHypothesisStatus(ctx, current.marketId, current.visualHypothesisId, "TESTING");
    } else if (
      input.status === "COMPLETED" &&
      (input.outcome === "CONFIRMED" || input.outcome === "REJECTED")
    ) {
      await setHypothesisStatus(ctx, current.marketId, current.visualHypothesisId, input.outcome);
    } else {
      // Cancelled, or completed without a clear answer: the hypothesis is untested again.
      await setHypothesisStatus(ctx, current.marketId, current.visualHypothesisId, "UNTESTED");
    }
  }
  await audit(ctx, {
    action: `experiment.${input.status.toLowerCase()}`,
    entityType: "experiment",
    entityId: input.id,
    ...(current.marketId ? { marketId: current.marketId } : {}),
    data: { from: current.status, ...(input.outcome ? { outcome: input.outcome } : {}) },
  });
  return row;
}

export const AssignArmInput = z.object({
  variantId: z.uuid(),
  /** Null takes the variant out of its experiment. */
  experimentId: z.uuid().nullable(),
  arm: z.enum(["A", "B"]).optional(),
});

/** Puts a variant into an arm of a DRAFT or RUNNING experiment of its market (or takes it out). */
export async function assignExperimentArm(
  ctx: ServiceContext,
  raw: z.input<typeof AssignArmInput>,
): Promise<{ experimentId: string | null; arm: "A" | "B" | null }> {
  requireEditor(ctx);
  const input = parseInput(AssignArmInput, raw);
  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, input.variantId));
  if (!variant) throw new NotFoundError("Variant not found.");
  if (input.experimentId === null) {
    await ctx.db
      .update(schema.contentVariants)
      .set({ experimentId: null, experimentArm: null })
      .where(eq(schema.contentVariants.id, variant.id));
    await audit(ctx, {
      action: "variant.experiment_cleared",
      entityType: "content_variant",
      entityId: variant.id,
      marketId: variant.marketId,
    });
    return { experimentId: null, arm: null };
  }
  if (!input.arm) {
    throw new ValidationError("Pick an arm.", { fieldErrors: { arm: ["Pick A or B."] } });
  }
  const experiment = await loadExperiment(ctx, input.experimentId);
  if (experiment.status !== "DRAFT" && experiment.status !== "RUNNING") {
    throw new InvalidStateError("The experiment is over; start a new one.");
  }
  if (experiment.marketId && experiment.marketId !== variant.marketId) {
    throw new ValidationError("The experiment is for another market.");
  }
  if (variant.status === "REJECTED")
    throw new InvalidStateError("A rejected draft cannot join an experiment.");
  await ctx.db
    .update(schema.contentVariants)
    .set({ experimentId: experiment.id, experimentArm: input.arm })
    .where(eq(schema.contentVariants.id, variant.id));
  await audit(ctx, {
    action: "variant.experiment_assigned",
    entityType: "content_variant",
    entityId: variant.id,
    marketId: variant.marketId,
    data: { experimentId: experiment.id, arm: input.arm },
  });
  return { experimentId: experiment.id, arm: input.arm };
}

// --- Results -------------------------------------------------------------------------------------

export type ArmResult = {
  /** Variants in the arm (any status). */
  assigned: number;
  /** Published posts of the arm with the primary metric at D7. */
  n: number;
  median: number | null;
};

export type ExperimentResult = {
  experimentId: string;
  metric: "save_rate" | "share_rate";
  minPostsPerArm: number;
  a: ArmResult;
  b: ArmResult;
  /** Both arms have the minimum: the comparison below is shown. */
  sufficient: boolean;
  /** Median of B minus median of A; null until sufficient. */
  difference: number | null;
  pValue: number | null;
  method: "exact" | "normal" | null;
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** The numbers of each arm; the comparison only when both arms reach the minimum (11 §11.6). */
export async function getExperimentResults(
  ctx: ServiceContext,
  experimentIds: readonly string[],
): Promise<ExperimentResult[]> {
  if (experimentIds.length === 0) return [];
  const experiments = await ctx.db
    .select()
    .from(schema.experiments)
    .where(inArray(schema.experiments.id, [...experimentIds]));
  const assigned = await ctx.db
    .select({
      experimentId: schema.contentVariants.experimentId,
      arm: schema.contentVariants.experimentArm,
    })
    .from(schema.contentVariants)
    .where(inArray(schema.contentVariants.experimentId, [...experimentIds]));
  const d = schema.vPublicationDimensions;
  const m = schema.vPublicationMetricsD7;
  const measured = await ctx.db
    .select({
      experimentId: d.experimentId,
      arm: d.experimentArm,
      saveRate: m.saveRate,
      shareRate: m.shareRate,
    })
    .from(d)
    .innerJoin(m, eq(m.publicationId, d.publicationId))
    .where(and(inArray(d.experimentId, [...experimentIds]), isNotNull(d.experimentArm)));

  return experiments.map((x) => {
    const values = (arm: "A" | "B") =>
      measured
        .filter((r) => r.experimentId === x.id && r.arm === arm)
        .flatMap((r) => {
          const v = x.primaryMetric === "share_rate" ? r.shareRate : r.saveRate;
          return v === null ? [] : [Number(v)];
        });
    const a = values("A");
    const b = values("B");
    const arm = (key: "A" | "B", list: number[]): ArmResult => ({
      assigned: assigned.filter((v) => v.experimentId === x.id && v.arm === key).length,
      n: list.length,
      median: median(list),
    });
    const sufficient = a.length >= x.minPostsPerArm && b.length >= x.minPostsPerArm;
    const test = sufficient ? mannWhitneyU(b, a) : null;
    return {
      experimentId: x.id,
      metric: x.primaryMetric,
      minPostsPerArm: x.minPostsPerArm,
      a: arm("A", a),
      b: arm("B", b),
      sufficient,
      difference: sufficient ? (median(b) as number) - (median(a) as number) : null,
      pValue: test?.p ?? null,
      method: test?.method ?? null,
    };
  });
}

export type ExperimentListItem = ExperimentRow & {
  marketCode: string | null;
  result: ExperimentResult;
};

export async function listExperiments(
  ctx: ServiceContext,
  options: { marketId?: string; statuses?: readonly ExperimentStatus[] } = {},
): Promise<ExperimentListItem[]> {
  const rows = await ctx.db
    .select({ experiment: schema.experiments, marketCode: schema.markets.code })
    .from(schema.experiments)
    .leftJoin(schema.markets, eq(schema.markets.id, schema.experiments.marketId))
    .where(
      and(
        ...(options.marketId ? [eq(schema.experiments.marketId, options.marketId)] : []),
        ...(options.statuses?.length
          ? [inArray(schema.experiments.status, [...options.statuses])]
          : []),
      ),
    )
    .orderBy(desc(schema.experiments.createdAt));
  const results = new Map(
    (
      await getExperimentResults(
        ctx,
        rows.map((r) => r.experiment.id),
      )
    ).map((r) => [r.experimentId, r]),
  );
  return rows.map((r) => ({
    ...r.experiment,
    marketCode: r.marketCode,
    result: results.get(r.experiment.id) as ExperimentResult,
  }));
}

/** The visual hypotheses of each market, for the experiment form. */
export async function listVisualHypotheses(
  ctx: ServiceContext,
): Promise<Map<string, VisualHypothesis[]>> {
  const rows = await ctx.db
    .select({ id: schema.markets.id, hypotheses: schema.markets.visualHypotheses })
    .from(schema.markets);
  return new Map(rows.map((r) => [r.id, r.hypotheses ?? []]));
}

export type ArmChoice = {
  /** The variant's experiment and arm now, or null. */
  current: { experimentId: string; name: string; arm: "A" | "B" } | null;
  /** DRAFT and RUNNING experiments of the variant's market. */
  open: {
    id: string;
    name: string;
    variantA: string;
    variantB: string;
    status: ExperimentStatus;
  }[];
};

/** What the review screen's arm picker shows for each variant (M7-06). */
export async function getArmChoices(
  ctx: ServiceContext,
  variantIds: readonly string[],
): Promise<Record<string, ArmChoice>> {
  if (variantIds.length === 0) return {};
  const variants = await ctx.db
    .select({
      id: schema.contentVariants.id,
      marketId: schema.contentVariants.marketId,
      experimentId: schema.contentVariants.experimentId,
      arm: schema.contentVariants.experimentArm,
    })
    .from(schema.contentVariants)
    .where(inArray(schema.contentVariants.id, [...variantIds]));
  const marketIds = [...new Set(variants.map((v) => v.marketId))];
  const experimentIds = variants.flatMap((v) => (v.experimentId ? [v.experimentId] : []));
  const experiments = await ctx.db
    .select()
    .from(schema.experiments)
    .orderBy(desc(schema.experiments.createdAt));
  const relevant = experiments.filter(
    (x) =>
      experimentIds.includes(x.id) ||
      (x.marketId !== null &&
        marketIds.includes(x.marketId) &&
        (x.status === "DRAFT" || x.status === "RUNNING")),
  );
  const out: Record<string, ArmChoice> = {};
  for (const v of variants) {
    const current = v.experimentId ? relevant.find((x) => x.id === v.experimentId) : undefined;
    out[v.id] = {
      current:
        current && v.arm ? { experimentId: current.id, name: current.name, arm: v.arm } : null,
      open: relevant
        .filter(
          (x) => x.marketId === v.marketId && (x.status === "DRAFT" || x.status === "RUNNING"),
        )
        .map((x) => ({
          id: x.id,
          name: x.name,
          variantA: x.variantA,
          variantB: x.variantB,
          status: x.status,
        })),
    };
  }
  return out;
}
