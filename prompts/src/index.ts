import {
  contentWriterV1,
  contentWriterV2,
  contentWriterV3,
  contentWriterV4,
  contentWriterV5,
} from "./content-writer";
import { criticV1, criticV2, criticV3 } from "./critic";
import { evalJudgeV1, evalJudgeV2 } from "./eval-judge";
import { fieldRegeneratorV1 } from "./field-regenerator";
import { ideaGeneratorV1, ideaGeneratorV2 } from "./idea-generator";
import { knowledgeExtractorV1, knowledgeExtractorV2 } from "./knowledge-extractor";
import { knowledgeGlossV1, knowledgeGlossV2 } from "./knowledge-gloss";
import { marketAdapterV1, marketAdapterV2, marketAdapterV3 } from "./market-adapter";
import { pageTranscriberV1, pageTranscriberV2 } from "./page-transcriber";
import { postAnnotatorV1, postAnnotatorV2 } from "./post-annotator";
import { createRegistry } from "./registry";
import {
  visualDirectorV1,
  visualDirectorV2,
  visualDirectorV3,
  visualDirectorV4,
  visualDirectorV5,
  visualDirectorV6,
} from "./visual-director";
import { visualQaV1, visualQaV2 } from "./visual-qa";

export const PACKAGE_NAME = "@rc/prompts";

export * as contentWriter from "./content-writer";
export * as critic from "./critic";
export {
  type AnyPrompt,
  definePrompt,
  type Effort,
  outputSchema,
  PROMPT_STAGES,
  type Prompt,
  type PromptContent,
  type PromptDefinition,
  type PromptStage,
  promptHash,
  renderPrompt,
  renderSnapshot,
  type SystemBlock,
} from "./define";
export * as evalJudge from "./eval-judge";
export * as fieldRegenerator from "./field-regenerator";
export * as ideaGenerator from "./idea-generator";
export * as knowledgeExtractor from "./knowledge-extractor";
export * as knowledgeGloss from "./knowledge-gloss";
export * as marketAdapter from "./market-adapter";
export * as pageTranscriber from "./page-transcriber";
export * as postAnnotator from "./post-annotator";
export { createRegistry, type PromptRegistry } from "./registry";
export {
  BANNED_HOOK_PATTERNS,
  type BannedHookPattern,
  findBannedHookPatterns,
  HOOK_LANGUAGES,
  HOOK_LIBRARY,
  type HookLanguage,
  type HookLibraryEntry,
  hookGuidance,
  hookLanguage,
  hookPatternsLine,
} from "./shared/hook-library";
export * as visualDirector from "./visual-director";
export * as visualQa from "./visual-qa";
export {
  type Attrs,
  type Body,
  escapeAttr,
  escapeText,
  type Raw,
  raw,
  renderSections,
  section,
} from "./xml";

/** Every released prompt version. Each prompt task adds its `vN.ts` here. */
export const promptRegistry = createRegistry([
  knowledgeExtractorV1,
  knowledgeExtractorV2,
  postAnnotatorV1,
  postAnnotatorV2,
  pageTranscriberV1,
  pageTranscriberV2,
  knowledgeGlossV1,
  knowledgeGlossV2,
  ideaGeneratorV1,
  ideaGeneratorV2,
  marketAdapterV1,
  marketAdapterV2,
  marketAdapterV3,
  contentWriterV1,
  contentWriterV2,
  contentWriterV3,
  contentWriterV4,
  contentWriterV5,
  criticV1,
  criticV2,
  criticV3,
  evalJudgeV1,
  evalJudgeV2,
  visualDirectorV1,
  visualDirectorV2,
  visualDirectorV3,
  visualDirectorV4,
  visualDirectorV5,
  visualDirectorV6,
  fieldRegeneratorV1,
  visualQaV1,
  visualQaV2,
]);
