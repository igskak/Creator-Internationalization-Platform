import type { Effort, PromptStage } from "@rc/prompts";

// Active prompt version, model and limits per stage (plan 07 §7.5, §7.6.1). Changing an entry is
// a pipeline change: bump PIPELINE_VERSION in ./version.ts and record the eval result in the
// decision log (07 §7.12).

/** Owner decision 2026-10-03: Claude Opus 5.5 for every stage. */
export const DEFAULT_MODEL = "claude-opus-5-5";

export type StageConfig = {
  promptId: string;
  /** Active version of the prompt. */
  version: number;
  model: string;
  /** Always explicit: Opus 5.5 defaults to `medium`, which is not what every stage wants. */
  effort: Effort;
  maxTokens: number;
  /** Stream the response (long outputs). */
  stream?: boolean;
};

const stage = (
  promptId: string,
  effort: Effort,
  maxTokens: number,
  extra: Pick<StageConfig, "stream"> = {},
): StageConfig => ({ promptId, version: 1, model: DEFAULT_MODEL, effort, maxTokens, ...extra });

export const STAGE_CONFIG: Record<PromptStage, StageConfig> = {
  KNOWLEDGE_EXTRACTION: stage("knowledge-extractor", "medium", 32_000, { stream: true }),
  IDEA_GENERATION: stage("idea-generator", "high", 16_000),
  MARKET_ADAPTATION: stage("market-adapter", "high", 16_000),
  CONTENT_WRITING: stage("content-writer", "high", 16_000),
  CRITIC: stage("critic", "high", 16_000),
  VISUAL_DIRECTION: stage("visual-director", "medium", 16_000),
  FIELD_REGENERATION: stage("field-regenerator", "high", 8_000),
  POST_ANNOTATION: stage("post-annotator", "low", 4_000),
  KNOWLEDGE_GLOSS: stage("knowledge-gloss", "low", 4_000),
  VISUAL_QA: stage("visual-qa", "medium", 8_000),
  EVAL_JUDGE: stage("eval-judge", "high", 8_000),
  PAGE_TRANSCRIPTION: stage("page-transcriber", "low", 16_000),
};
