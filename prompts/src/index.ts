import { knowledgeExtractorV1 } from "./knowledge-extractor";
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
export * as knowledgeExtractor from "./knowledge-extractor";
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
export const promptRegistry = createRegistry([knowledgeExtractorV1]);
