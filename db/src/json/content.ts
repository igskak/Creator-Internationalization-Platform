import { z } from "zod";
import { ValidationIssue } from "./validation";

// JSON column shapes for 0003_content (plan 04 §4.4). Services validate with these on every write.
// ValidationIssue lives in ./validation.

export const SLIDE_ROLES = [
  "HOOK",
  "PROBLEM",
  "EXPLANATION",
  "STEP",
  "MISTAKE",
  "CORRECT",
  "FACT",
  "COMPARISON",
  "SUMMARY",
  "CTA",
] as const;
export const SlideRole = z.enum(SLIDE_ROLES);
export type SlideRole = z.infer<typeof SlideRole>;

/** Template ids A–F (08 §8.2.1). */
export const TEMPLATE_IDS = ["A", "B", "C", "D", "E", "F"] as const;
export const TemplateId = z.enum(TEMPLATE_IDS);
export type TemplateId = z.infer<typeof TemplateId>;

/** content_variants.slides_json[] */
export const Slide = z.object({
  /** nanoid; stable across edits (used in field paths). */
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  role: SlideRole,
  templateId: TemplateId,
  /** Text slots defined by the template (08 §8.2). */
  slots: z.record(z.string(), z.string()),
  /** Image slots. */
  images: z.record(z.string(), z.object({ assetId: z.string().min(1).optional() })),
  /** Cited cards; must be linked to the Master Idea. */
  knowledgeIds: z.array(z.string().min(1)),
  /** true → must cite at least one card. */
  factual: z.boolean(),
  altText: z.string().optional(),
});
export type Slide = z.infer<typeof Slide>;
export const SlideList = z.array(Slide);

export const CTA_LINK_MODES = ["LINK_IN_BIO", "DM", "NONE"] as const;

/** content_variants.cta_json */
export const CtaSpec = z.object({
  /** taxonomy cta_type code */
  type: z.string().min(1),
  text: z.string(),
  keyword: z.string().min(1).optional(),
  offerId: z.string().min(1).optional(),
  linkMode: z.enum(CTA_LINK_MODES).optional(),
});
export type CtaSpec = z.infer<typeof CtaSpec>;

/** content_variants.utm_json [S§13.1] */
export const UtmSpec = z.object({
  source: z.literal("instagram"),
  medium: z.literal("social"),
  campaign: z.string().min(1),
  content: z.string().min(1),
  url: z.string().min(1).optional(),
});
export type UtmSpec = z.infer<typeof UtmSpec>;

/** content_variants.content_length */
export const ContentLength = z.object({
  slides: z.number().int().nonnegative(),
  wordsTotal: z.number().int().nonnegative(),
  captionChars: z.number().int().nonnegative(),
});
export type ContentLength = z.infer<typeof ContentLength>;

export const UNIT_SYSTEMS = ["METRIC", "IMPERIAL", "DUAL"] as const;

/** content_variants.market_brief_json: output of the market adapter [S§7.2]. */
export const MarketBrief = z.object({
  audienceFraming: z.string(),
  terminology: z.array(
    z.object({
      concept: z.string().min(1),
      localTerm: z.string().min(1),
      avoid: z.array(z.string()),
    }),
  ),
  substitutions: z.array(
    z.object({
      original: z.string().min(1),
      local: z.string().min(1),
      note: z.string(),
      factualImpact: z.enum(["NONE", "NEEDS_CHECK"]),
    }),
  ),
  unitsPolicy: z.object({
    system: z.enum(UNIT_SYSTEMS),
    conversions: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
  }),
  culturalHooks: z.array(z.string()),
  examples: z.array(z.string()),
  tone: z.string(),
  /** taxonomy hook_type code */
  hookType: z.string().min(1),
  slidePlan: z.array(
    z.object({
      role: SlideRole,
      templateId: TemplateId,
      purpose: z.string(),
      knowledgeIds: z.array(z.string().min(1)),
    }),
  ),
  ctaApproach: z.object({
    ctaType: z.string().min(1),
    keywordSuggestion: z.string().min(1).optional(),
  }),
  risks: z.array(z.string()),
  differentiationNotes: z.string(),
});
export type MarketBrief = z.infer<typeof MarketBrief>;

export const VISUAL_ASPECTS = ["4:5", "1:1", "3:4", "16:9"] as const;

/** content_variants.visual_brief_json (filled from M3). */
export const VisualBrief = z.object({
  concept: z.string(),
  visualStyle: z.string().min(1),
  hypothesisId: z.string().min(1).optional(),
  slides: z.array(
    z.object({
      slideId: z.string().min(1),
      slot: z.string().min(1),
      source: z.enum(["GENERATE", "LIBRARY", "NONE"]),
      libraryAssetId: z.string().min(1).optional(),
      prompt: z.string().optional(),
      negativePrompt: z.string().optional(),
      composition: z.string(),
      aspect: z.enum(VISUAL_ASPECTS),
    }),
  ),
  differentiationFromSibling: z.string(),
});
export type VisualBrief = z.infer<typeof VisualBrief>;

export const CRITIC_VERDICTS = ["PASS", "REQUEST_REWRITE", "FLAG_FOR_HUMAN"] as const;

const criticScore = z.number().min(1).max(5);

/** content_variants.critic_report */
export const CriticReport = z.object({
  verdict: z.enum(CRITIC_VERDICTS),
  iteration: z.number().int().nonnegative(),
  /** 1–5. */
  scores: z.object({
    factualFidelity: criticScore,
    sourceCoverage: criticScore,
    localization: criticScore,
    originality: criticScore,
    brandVoice: criticScore,
    structure: criticScore,
    cta: criticScore,
    /** From critic@2 (M2-12a); older reports have none. */
    hook: criticScore.optional(),
    overall: criticScore,
  }),
  unsupportedClaims: z.array(
    z.object({ fieldPath: z.string(), text: z.string(), reason: z.string() }),
  ),
  issues: z.array(
    z.object({
      severity: z.enum(["BLOCKER", "MAJOR", "MINOR"]),
      category: z.string().min(1),
      fieldPath: z.string().optional(),
      explanation: z.string(),
      suggestedFix: z.string().optional(),
    }),
  ),
  rewriteInstructions: z.string().optional(),
  humanAttention: z.string().optional(),
  deterministicIssues: z.array(ValidationIssue),
});
export type CriticReport = z.infer<typeof CriticReport>;

const similarity = z.number().min(0).max(1);

/** content_variants.differentiation_report (07 §7.10). */
export const DifferentiationReport = z.object({
  hookSimilarity: similarity,
  slideTextSimilarity: similarity,
  templateSequenceSimilarity: similarity,
  sameHookType: z.boolean(),
  visualPromptSimilarity: similarity.optional(),
  verdict: z.enum(["OK", "WARN", "FAIL"]),
  reasons: z.array(z.string()),
  thresholdsVersion: z.string().min(1),
});
export type DifferentiationReport = z.infer<typeof DifferentiationReport>;

/** content_variants.generation_config */
export const GenerationConfig = z.object({
  /** semver, modules/ai/version.ts */
  pipelineVersion: z.string().min(1),
  stages: z.record(
    z.string(),
    z.object({
      promptId: z.string().min(1),
      promptVersion: z.number().int().positive(),
      model: z.string().min(1),
      effort: z.string().optional(),
    }),
  ),
  templatesVersion: z.string().optional(),
  imageModel: z.string().optional(),
  embeddingModel: z.string().min(1),
});
export type GenerationConfig = z.infer<typeof GenerationConfig>;

/** content_variants.pipeline_state: lets the pipeline resume after a crash. */
export const PipelineState = z.object({
  pipelineRunId: z.string().min(1),
  stage: z.string().min(1),
  startedAt: z.string().min(1),
  completedStages: z.array(z.string()),
  runIds: z.record(z.string(), z.string()),
});
export type PipelineState = z.infer<typeof PipelineState>;

/** content_variants.flags[] (04 §4.4). */
export const VARIANT_FLAGS = [
  "GENERATION_FAILED",
  "UNSUPPORTED_CLAIM",
  "SAFETY_REVIEW",
  "DUPLICATION_RISK",
  "NUMERIC_MISMATCH",
  "TEXT_OVERFLOW",
  "MISSING_GLYPH",
  "RENDER_FAILED",
  "VISUAL_MISSING",
  "KNOWLEDGE_CHANGED",
  "KNOWLEDGE_ARCHIVED",
] as const;
export const VariantFlag = z.enum(VARIANT_FLAGS);
export type VariantFlag = z.infer<typeof VariantFlag>;

/** Flags that block approval; SAFETY_REVIEW additionally needs a checklist. */
export const BLOCKING_VARIANT_FLAGS: readonly VariantFlag[] = [
  "UNSUPPORTED_CLAIM",
  "NUMERIC_MISMATCH",
  "TEXT_OVERFLOW",
  "MISSING_GLYPH",
  "RENDER_FAILED",
  "VISUAL_MISSING",
  "KNOWLEDGE_ARCHIVED",
];

/** carousel_renders.qa_report (plan 04 §4.4, 08 §8.7). */
export const QaReport = z.object({
  overflow: z.array(
    z.object({ slideId: z.string(), slot: z.string(), fontPxUsed: z.number().nonnegative() }),
  ),
  missingGlyphs: z.array(
    z.object({ slideId: z.string(), slot: z.string(), chars: z.array(z.string()) }),
  ),
  dimensionsOk: z.boolean(),
  logoPlacementOk: z.boolean(),
  fileSizes: z.array(z.number().int().nonnegative()),
  durationMs: z.number().nonnegative(),
});
export type QaReport = z.infer<typeof QaReport>;
