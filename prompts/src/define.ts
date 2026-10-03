import { createHash } from "node:crypto";
import type { z } from "zod";

// Prompt definitions (plan 07 §7.5). A released version file is never edited: a change is a new
// `vN.ts` plus an eval run.

/** Generation stages, the same names as the `generation_stage` database enum. */
export const PROMPT_STAGES = [
  "KNOWLEDGE_EXTRACTION",
  "IDEA_GENERATION",
  "MARKET_ADAPTATION",
  "CONTENT_WRITING",
  "CRITIC",
  "VISUAL_DIRECTION",
  "FIELD_REGENERATION",
  "POST_ANNOTATION",
  "KNOWLEDGE_GLOSS",
  "VISUAL_QA",
  "EVAL_JUDGE",
  "PAGE_TRANSCRIPTION",
] as const;
export type PromptStage = (typeof PROMPT_STAGES)[number];

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** A system block; stable blocks come first, `cache` hints the last stable one (07 §7.3). */
export type SystemBlock = { text: string; cache?: boolean };

/** One piece of user message content. Binary documents are added by the caller, not the prompt. */
export type PromptContent = { type: "text"; text: string };

export type PromptDefinition<I, O> = {
  /** kebab-case, e.g. 'content-writer'. */
  id: string;
  /** Positive integer, the `vN` of the file. */
  version: number;
  stage: PromptStage;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  defaults: { effort?: Effort; maxTokens: number };
  system: readonly SystemBlock[];
  render: (input: I) => PromptContent[];
  /**
   * Describes the rendered sections (for example `<master_idea> <knowledge_cards> <task>`). It is
   * part of the hash, so a structural change of the user message must change it and the version.
   */
  renderTemplate?: string;
  changelog: string;
};

export type Prompt<I, O> = Readonly<PromptDefinition<I, O>> & {
  /** `id@version`, the registry key. */
  readonly key: string;
  /** SHA-256 over id, version, system blocks and render template. Stored as `prompt_hash`. */
  readonly hash: string;
};

/** Any prompt, for registries and the runner. */
// biome-ignore lint/suspicious/noExplicitAny: the registry holds prompts of different types
export type AnyPrompt = Prompt<any, any>;

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Hash that changes when the id, version, system texts or render template change. */
export function promptHash(
  definition: Pick<
    PromptDefinition<unknown, unknown>,
    "id" | "version" | "system" | "renderTemplate"
  >,
): string {
  // JSON of a fixed-shape array keeps the input unambiguous and independent of key order.
  const canonical = JSON.stringify([
    definition.id,
    definition.version,
    definition.system.map((block) => [block.text, block.cache === true]),
    definition.renderTemplate ?? "",
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function definePrompt<I, O>(definition: PromptDefinition<I, O>): Prompt<I, O> {
  if (!ID.test(definition.id)) {
    throw new Error(`Invalid prompt id "${definition.id}": use kebab-case.`);
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`Invalid version for ${definition.id}: use a positive integer.`);
  }
  if (!PROMPT_STAGES.includes(definition.stage)) {
    throw new Error(`Unknown stage "${definition.stage}" for ${definition.id}.`);
  }
  if (definition.system.length === 0 || definition.system.some((b) => !b.text.trim())) {
    throw new Error(`${definition.id}@${definition.version} needs non-empty system blocks.`);
  }
  if (!Number.isInteger(definition.defaults.maxTokens) || definition.defaults.maxTokens < 1) {
    throw new Error(
      `${definition.id}@${definition.version}: maxTokens must be a positive integer.`,
    );
  }
  if (!definition.changelog.trim()) {
    throw new Error(`${definition.id}@${definition.version} needs a changelog entry.`);
  }
  return Object.freeze({
    ...definition,
    system: Object.freeze(definition.system.map((block) => Object.freeze({ ...block }))),
    key: `${definition.id}@${definition.version}`,
    hash: promptHash(definition),
  });
}

/**
 * Validates `rawInput` with the prompt's input schema and renders the user content. Throws a
 * ZodError for bad input, so a stage fails before any model call.
 */
export function renderPrompt<I, O>(prompt: Prompt<I, O>, rawInput: unknown): PromptContent[] {
  return prompt.render(prompt.input.parse(rawInput));
}

/**
 * The full text a model would see, for snapshot tests: system blocks, then the user content, with
 * the prompt key and hash in the header. A test with `toMatchSnapshot()` or an inline snapshot
 * fails when the rendering changes without a new version.
 */
export function renderSnapshot<I, O>(prompt: Prompt<I, O>, rawInput: unknown): string {
  const system = prompt.system
    .map((block, i) => `--- system ${i + 1}${block.cache ? " (cache)" : ""} ---\n${block.text}`)
    .join("\n");
  const user = renderPrompt(prompt, rawInput)
    .map((part) => part.text)
    .join("\n");
  return `# ${prompt.key} ${prompt.hash.slice(0, 12)}\n${system}\n--- user ---\n${user}\n`;
}
