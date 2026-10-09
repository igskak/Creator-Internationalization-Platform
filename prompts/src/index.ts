import { contentWriterV1, contentWriterV2 } from "./content-writer";
import { criticV1, criticV2 } from "./critic";
import { evalJudgeV1 } from "./eval-judge";
import { ideaGeneratorV1 } from "./idea-generator";
import { knowledgeExtractorV1 } from "./knowledge-extractor";
import { knowledgeGlossV1 } from "./knowledge-gloss";
import { marketAdapterV1 } from "./market-adapter";
import { pageTranscriberV1 } from "./page-transcriber";
import { postAnnotatorV1 } from "./post-annotator";
import { createRegistry } from "./registry";

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
export * as ideaGenerator from "./idea-generator";
export * as knowledgeExtractor from "./knowledge-extractor";
export * as knowledgeGloss from "./knowledge-gloss";
export * as marketAdapter from "./market-adapter";
export * as pageTranscriber from "./page-transcriber";
export * as postAnnotator from "./post-annotator";
export { createRegistry, type PromptRegistry } from "./registry";
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
  postAnnotatorV1,
  pageTranscriberV1,
  knowledgeGlossV1,
  ideaGeneratorV1,
  marketAdapterV1,
  contentWriterV1,
  contentWriterV2,
  criticV1,
  criticV2,
  evalJudgeV1,
]);
