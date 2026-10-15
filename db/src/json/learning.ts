import { z } from "zod";

// JSON column shapes for 0012_learning (plan 04 §0008_learning, 11 §11.5, M7-01).

const Confidence = z.enum(["low", "medium", "high"]);

/** One dimension value that did better (or worse) than the market at D7. */
export const PerformancePattern = z.object({
  /** One of the learning dimensions: category, angle, hook_type, visual_style, … */
  dimension: z.string().min(1),
  value: z.string(),
  n: z.number().int().nonnegative(),
  metric: z.enum(["save_rate", "share_rate"]),
  /** Median of the group's rates over the market median (1 = like the market). */
  lift: z.number(),
  confidence: Confidence,
});
export type PerformancePattern = z.infer<typeof PerformancePattern>;

/**
 * `performance_summaries.summary_json`: the "performance memory" the idea generator and the writer
 * read (plan 11 §11.5). Kept under about 1,500 tokens; the raw groups are in `stats_json`.
 */
export const PerformanceMemory = z.object({
  /** A market code, or `ALL` for the summary across markets (rates relative to each market). */
  marketCode: z.string().min(1),
  window: z.object({ from: z.string(), to: z.string() }),
  basis: z.object({
    publications: z.number().int().nonnegative(),
    metric: z.literal("D7"),
    minSample: z.number().int().positive(),
  }),
  topPatterns: z.array(PerformancePattern),
  weakPatterns: z.array(PerformancePattern),
  overusedThemes: z.array(
    z.object({
      category: z.string(),
      angle: z.string().optional(),
      count: z.number().int(),
      windowDays: z.number().int(),
    }),
  ),
  coverageGaps: z.array(
    z.object({
      category: z.string(),
      approvedCards: z.number().int(),
      postsLast30d: z.number().int(),
    }),
  ),
  untestedHypotheses: z.array(
    z.object({
      source: z.enum(["visual_hypothesis", "experiment", "hook_type"]),
      description: z.string(),
    }),
  ),
  offerPriorities: z.array(
    z.object({
      offerId: z.string(),
      productCode: z.string(),
      priority: z.number().int(),
      leads: z.number().int().optional(),
      sales: z.number().int().optional(),
    }),
  ),
  feedback: z.object({
    topRejectionReasons: z.array(z.object({ code: z.string(), count: z.number().int() })),
    mostEditedFields: z.array(z.object({ field: z.string(), count: z.number().int() })),
    hookRewrites: z.array(z.object({ original: z.string(), edited: z.string() })),
  }),
  caveats: z.array(z.string()),
});
export type PerformanceMemory = z.infer<typeof PerformanceMemory>;

/** `performance_summaries.stats_json`: every group the patterns were chosen from. */
export type PerformanceStats = {
  marketMedians: Record<string, { saveRate: number | null; shareRate: number | null; n: number }>;
  groups: {
    dimension: string;
    value: string;
    n: number;
    saveLift: number | null;
    shareLift: number | null;
  }[];
};

/** Dimensions an experiment can compare (plan 11 §11.6). */
export const EXPERIMENT_DIMENSIONS = [
  "hook_type",
  "visual_style",
  "cta_type",
  "first_template",
  "daypart",
  "slide_count",
  "caption_length",
] as const;
export type ExperimentDimension = (typeof EXPERIMENT_DIMENSIONS)[number];
