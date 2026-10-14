import {
  type ForbiddenPattern,
  type GenerationInputRefs,
  ReelHookOption,
  ReelScene,
} from "@rc/db/json";
import type { AnyPrompt, reelDirector } from "@rc/prompts";
import { runStage, type StageConfig, type StageResult } from "../../ai";
import type { ServiceContext } from "../../core";
import type { NumberLocale } from "../../localization";
import { reelValidationContext, validateReelScript } from "./validate";

// The Reel director stage (plan 18 §18.4 step 1): one `runStage` call of reel-director with the
// deterministic checks of ./validate.ts as its validator, so a script that breaks a rule is repaired
// once and then fails. The answer is returned in the stored shape of `reel_scripts`.

export type DirectReelOptions = {
  /** Number convention of the cards: the market's. */
  locale: NumberLocale;
  /** `markets.forbidden_patterns`. */
  forbiddenPatterns?: readonly ForbiddenPattern[];
  inputRefs?: GenerationInputRefs;
  /** Use this prompt instead of the active one (evals). */
  prompt?: AnyPrompt;
  config?: Partial<StageConfig>;
};

/** What `reel_scripts` stores from the answer. */
export type ReelScriptDraft = {
  hookOptions: ReelHookOption[];
  chosenHookId: string;
  flashOpener: "ON" | "OFF";
  scenes: ReelScene[];
};

/** The answer in the stored shape: scenes get their `index`; every shape is parsed once more. */
export function toReelScriptDraft(output: reelDirector.ReelDirectorOutput): ReelScriptDraft {
  return {
    hookOptions: output.hookOptions.map((h) => ReelHookOption.parse(h)),
    chosenHookId: output.chosenHookId,
    flashOpener: output.flashOpener,
    scenes: output.scenes.map((s, index) => ReelScene.parse({ ...s, index })),
  };
}

export type DirectedReel = Omit<StageResult<reelDirector.ReelDirectorOutput>, "data"> & {
  /** Null when the stage failed (INVALID_OUTPUT, REFUSED). */
  script: ReelScriptDraft | null;
};

export async function directReel(
  ctx: ServiceContext,
  input: reelDirector.ReelDirectorInput,
  options: DirectReelOptions,
): Promise<DirectedReel> {
  const context = reelValidationContext(input, {
    locale: options.locale,
    ...(options.forbiddenPatterns ? { forbiddenPatterns: options.forbiddenPatterns } : {}),
  });
  const { data, ...result } = await runStage<reelDirector.ReelDirectorOutput>(ctx, {
    stage: "REEL_DIRECTION",
    input,
    validate: (output) => validateReelScript(output, context),
    ...(options.inputRefs ? { inputRefs: options.inputRefs } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    ...(options.config ? { config: options.config } : {}),
  });
  return { ...result, script: data ? toReelScriptDraft(data) : null };
}
