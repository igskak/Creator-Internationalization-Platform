import {
  type ForbiddenPattern,
  type GenerationInputRefs,
  ReelHookOption,
  ReelScene,
} from "@rc/db/json";
import { type AnyPrompt, REEL_LIMITS, REEL_LIMITS_V4, type reelDirector } from "@rc/prompts";
import { runStage, STAGE_CONFIG, type StageConfig, type StageResult } from "../../ai";
import type { ServiceContext } from "../../core";
import type { NumberLocale } from "../../localization";
import { type ReelScriptFormat, reelValidationContext, validateReelScript } from "./validate";

// The Reel director stage (plan 18 §18.4 step 1): one `runStage` call of reel-director with the
// deterministic checks of ./validate.ts as its validator, so a script that breaks a rule is repaired
// once and then fails. The answer is returned in the stored shape of `reel_scripts`, plus, from
// reel-director@2, the Reel's own post (caption without its hook line, ask, hashtags).

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

type Output =
  | reelDirector.ReelDirectorOutput
  | reelDirector.ReelDirectorOutputV2
  | reelDirector.ReelDirectorOutputV4;

/** The script format a prompt version writes: reel-director@4 and later write v4 scripts. */
export const reelScriptFormat = (version: number): ReelScriptFormat => (version >= 4 ? "v4" : "v3");

/** The Reel's own post (reel-director@2): the variant stores it, not `reel_scripts`. */
export type ReelPostDraft = {
  /** The caption without its first line, which `reelCaption` writes from the chosen hook. */
  body: string;
  cta: { type: string; text: string; keyword?: string };
  hashtags: string[];
};

/** What `reel_scripts` stores from the answer, and the post when the prompt wrote one. */
export type ReelScriptDraft = {
  hookOptions: ReelHookOption[];
  chosenHookId: string;
  flashOpener: "ON" | "OFF";
  scenes: ReelScene[];
  post?: ReelPostDraft;
};

/**
 * The calm hook (owner decision 2026-10-18): the first Reel with the flash opener kept viewers 2 s
 * against 4.3–5.0 s without it, so the opener is off whatever the prompt answers, and the hook scene
 * is held the longest a scene may last (2.5 s, 3.5 s in v4) for the question to be read before the
 * first cut. A v4 picture always fills the frame.
 */
const settle = (scene: Output["scenes"][number], index: number, format: ReelScriptFormat) => {
  const limits = format === "v4" ? REEL_LIMITS_V4 : REEL_LIMITS;
  const held = index === 0 ? { ...scene, beats: limits.maxBeats } : scene;
  return format === "v4" ? { ...held, layout: "FULL" as const } : held;
};

/** The answer in the stored shape: scenes get their `index`; every shape is parsed once more. */
export function toReelScriptDraft(
  output: Output,
  format: ReelScriptFormat = "v3",
): ReelScriptDraft {
  const post =
    "caption" in output
      ? {
          body: output.caption.trim(),
          cta: {
            type: output.cta.type,
            text: output.cta.text.trim(),
            ...(output.cta.keyword ? { keyword: output.cta.keyword } : {}),
          },
          hashtags: output.hashtags,
        }
      : undefined;
  return {
    hookOptions: output.hookOptions.map((h) => ReelHookOption.parse(h)),
    chosenHookId: output.chosenHookId,
    flashOpener: "OFF",
    scenes: output.scenes.map((s, index) =>
      ReelScene.parse({ ...settle(s, index, format), index }),
    ),
    ...(post ? { post } : {}),
  };
}

export type DirectedReel = Omit<StageResult<Output>, "data"> & {
  /** Null when the stage failed (INVALID_OUTPUT, REFUSED). */
  script: ReelScriptDraft | null;
};

export async function directReel(
  ctx: ServiceContext,
  input: reelDirector.ReelDirectorInput | reelDirector.ReelDirectorInputV2,
  options: DirectReelOptions,
): Promise<DirectedReel> {
  const format = reelScriptFormat(options.prompt?.version ?? STAGE_CONFIG.REEL_DIRECTION.version);
  const context = reelValidationContext(input, {
    format,
    locale: options.locale,
    ...(options.forbiddenPatterns ? { forbiddenPatterns: options.forbiddenPatterns } : {}),
  });
  const { data, ...result } = await runStage<Output>(ctx, {
    stage: "REEL_DIRECTION",
    input,
    validate: (output) => validateReelScript(output, context),
    ...(options.inputRefs ? { inputRefs: options.inputRefs } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    ...(options.config ? { config: options.config } : {}),
  });
  return { ...result, script: data ? toReelScriptDraft(data, format) : null };
}
