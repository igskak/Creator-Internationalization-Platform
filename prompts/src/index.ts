import { ideaGeneratorV1 } from "./idea-generator";
import { knowledgeExtractorV1 } from "./knowledge-extractor";
import { knowledgeGlossV1 } from "./knowledge-gloss";
import { pageTranscriberV1 } from "./page-transcriber";
import { postAnnotatorV1 } from "./post-annotator";
import { createRegistry } from "./registry";

export const PACKAGE_NAME = "@rc/prompts";

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
export * as ideaGenerator from "./idea-generator";
export * as knowledgeExtractor from "./knowledge-extractor";
export * as knowledgeGloss from "./knowledge-gloss";
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
]);
