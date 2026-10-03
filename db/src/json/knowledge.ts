import { z } from "zod";

// JSON column shapes for 0002_knowledge (plan 04 §4.4). Services validate with these on every write.
// RightsPolicy lives in ./rights.

/** source_assets.processing_progress */
export const ProcessingProgress = z.object({
  stage: z.string().optional(),
  pagesTotal: z.number().int().nonnegative().optional(),
  batchesTotal: z.number().int().nonnegative().optional(),
  batchesDone: z.number().int().nonnegative().optional(),
  cardsCreated: z.number().int().nonnegative().optional(),
  /** Batches that could not be extracted; the source can still be READY (06 J1 step 9). */
  failedBatches: z
    .array(
      z.object({
        batchIndex: z.number().int().nonnegative(),
        pageStart: z.number().int().positive(),
        pageEnd: z.number().int().positive(),
        code: z.string(),
      }),
    )
    .optional(),
});
export type ProcessingProgress = z.infer<typeof ProcessingProgress>;

/** source_assets.processing_error and knowledge_extraction_batches.error */
export const ProcessingError = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ProcessingError = z.infer<typeof ProcessingError>;

/** source_pages.locator: transcripts carry a time range, imported posts an external id. */
export const PageLocator = z.object({
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  externalId: z.string().min(1).optional(),
});
export type PageLocator = z.infer<typeof PageLocator>;

/** knowledge_items.source_reference [C-06] */
export const SourceReference = z.object({
  pageStart: z.number().int().positive().optional(),
  pageEnd: z.number().int().positive().optional(),
  sectionPath: z.string().optional(),
  locator: PageLocator.optional(),
  /** Verbatim, in the source language. */
  quote: z.string().max(400),
  quoteVerified: z.boolean(),
  matchScore: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
});
export type SourceReference = z.infer<typeof SourceReference>;

export const ProcedureStep = z.object({ n: z.number().int().positive(), text: z.string().min(1) });
export type ProcedureStep = z.infer<typeof ProcedureStep>;

export const Ingredient = z.object({
  name: z.string().min(1),
  quantity: z.number().nonnegative().optional(),
  unit: z.string().min(1).optional(),
  note: z.string().optional(),
});
export type Ingredient = z.infer<typeof Ingredient>;

export const TEMPERATURE_TARGETS = [
  "OVEN",
  "PAN",
  "OIL",
  "WATER",
  "CORE",
  "FRIDGE",
  "FREEZER",
  "OTHER",
] as const;

export const Temperature = z.object({
  value: z.number(),
  unit: z.enum(["C", "F"]),
  target: z.enum(TEMPERATURE_TARGETS),
  context: z.string(),
});
export type Temperature = z.infer<typeof Temperature>;

export const Timing = z
  .object({
    value: z.number().nonnegative(),
    valueMax: z.number().nonnegative().optional(),
    unit: z.enum(["s", "min", "h", "d"]),
    context: z.string(),
  })
  .refine((t) => t.valueMax === undefined || t.valueMax >= t.value, {
    path: ["valueMax"],
    message: "valueMax must be >= value",
  });
export type Timing = z.infer<typeof Timing>;

export const CommonMistake = z.object({
  mistake: z.string().min(1),
  why: z.string().optional(),
  fix: z.string().optional(),
});
export type CommonMistake = z.infer<typeof CommonMistake>;

export const ProcedureList = z.array(ProcedureStep);
export const IngredientList = z.array(Ingredient);
export const TemperatureList = z.array(Temperature);
export const TimingList = z.array(Timing);
export const CommonMistakeList = z.array(CommonMistake);

/** knowledge_items.gloss_en (P1): an English reading aid, never authoritative. */
export const KnowledgeGloss = z.object({
  title: z.string(),
  claim: z.string(),
  explanation: z.string(),
  model: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type KnowledgeGloss = z.infer<typeof KnowledgeGloss>;

/** knowledge_item_versions.snapshot: all content fields at approval time. */
export const KnowledgeSnapshot = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().nullable(),
  claim: z.string().min(1),
  explanation: z.string(),
  procedure: ProcedureList,
  ingredients: IngredientList,
  temperatures: TemperatureList,
  timings: TimingList,
  commonMistakes: CommonMistakeList,
  sourceReference: SourceReference.nullable(),
  language: z.string().min(1),
  safetySensitive: z.boolean(),
  safetyNotes: z.string().nullable(),
  tags: z.array(z.string()),
});
export type KnowledgeSnapshot = z.infer<typeof KnowledgeSnapshot>;

/** generation_runs.params */
export const GenerationParams = z.object({
  effort: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  thinking: z.unknown().optional(),
  stream: z.boolean().optional(),
  /** The model that actually answered differs from `generation_runs.model` only after a fallback. */
  fallbackRan: z.boolean().optional(),
  retriedForMaxTokens: z.boolean().optional(),
});
export type GenerationParams = z.infer<typeof GenerationParams>;

/** generation_runs.input_refs */
export const GenerationInputRefs = z.object({
  sourceAssetId: z.uuid().optional(),
  pageRange: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  masterIdeaId: z.uuid().optional(),
  variantId: z.uuid().optional(),
  knowledgeItemIds: z.array(z.uuid()).optional(),
});
export type GenerationInputRefs = z.infer<typeof GenerationInputRefs>;

/** generation_runs.usage */
export const GenerationUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
});
export type GenerationUsage = z.infer<typeof GenerationUsage>;

/** historical_posts.metrics */
export const PostMetrics = z.object({
  likes: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  saves: z.number().int().nonnegative().optional(),
  shares: z.number().int().nonnegative().optional(),
  reach: z.number().int().nonnegative().optional(),
  views: z.number().int().nonnegative().optional(),
  collectedAt: z.iso.datetime({ offset: true }).optional(),
});
export type PostMetrics = z.infer<typeof PostMetrics>;

/** historical_posts.annotations; values are taxonomy codes validated in the service. */
export const PostAnnotations = z.object({
  category: z.string().optional(),
  angle: z.string().optional(),
  hookType: z.string().optional(),
  ctaType: z.string().optional(),
  productCode: z.string().optional(),
  visualPattern: z.string().optional(),
});
export type PostAnnotations = z.infer<typeof PostAnnotations>;
