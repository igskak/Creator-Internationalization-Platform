import type { ForbiddenPattern, ValidationIssue } from "@rc/db/json";
import { findBannedHookPatterns, hookLanguage, REEL_LIMITS, type reelDirector } from "@rc/prompts";
import { stripEmphasis } from "@rc/templates";
import { compileForbiddenPatterns, integersIn, withoutUnitNumbers } from "../../content/validation";
import { checkNumericFidelity, type NumberLocale } from "../../localization";

// Deterministic checks of a Reel script (plan 18 §18.4 step 1, docs/design/reel-style.md,
// docs/design/hook-library.md). Pure functions: a script and a context in, `ValidationIssue[]` out.
// BLOCKER issues go to the repair of `runStage` (once); MAJOR and MINOR ones are returned as notes.

type Output = reelDirector.ReelDirectorOutput;
type Scene = reelDirector.ReelDirectorScene;
type Input = reelDirector.ReelDirectorInput;

const L = REEL_LIMITS;

export type ReelValidationContext = {
  /** Number convention of the cards. */
  locale: NumberLocale;
  /** The carousel's slides, the only source of facts. */
  slides: ReadonlyMap<string, string>;
  pictureIds: ReadonlySet<string>;
  hookTypes: ReadonlySet<string>;
  /** The other market's script whose shots are reused; its scenes are locked. */
  baseScript?: Input["baseScript"];
  /** `markets.forbidden_patterns`. */
  forbiddenPatterns: readonly ForbiddenPattern[];
};

export function reelValidationContext(
  input: Input,
  options: { locale: NumberLocale; forbiddenPatterns?: readonly ForbiddenPattern[] },
): ReelValidationContext {
  return {
    locale: options.locale,
    slides: new Map(input.carousel.slides.map((s) => [s.id, s.text])),
    pictureIds: new Set(input.pictures.map((p) => p.id)),
    hookTypes: new Set(input.taxonomy.hookTypes.map((t) => t.code)),
    ...(input.baseScript ? { baseScript: input.baseScript } : {}),
    forbiddenPatterns: options.forbiddenPatterns ?? [],
  };
}

const blocker = (
  code: string,
  fieldPath: string,
  message: string,
  fixHint: string,
): ValidationIssue => ({ code, severity: "BLOCKER", fieldPath, message, fixHint });
const major = (
  code: string,
  fieldPath: string,
  message: string,
  fixHint: string,
): ValidationIssue => ({ code, severity: "MAJOR", fieldPath, message, fixHint });

// --- cards -----------------------------------------------------------------------------------

/** Words of a card without the accent marks. */
export const cardWordList = (card: string) => stripEmphasis(card).split(/\s+/u).filter(Boolean);

function checkCard(card: string, fieldPath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const marks = card.split("**").length - 1;
  const words = cardWordList(card);
  const plain = stripEmphasis(card).trim();
  if (words.length === 0) {
    return [blocker("REEL_CARD_EMPTY", fieldPath, "The card is empty.", "Write the card.")];
  }
  if (marks % 2 !== 0 || marks > 2) {
    issues.push(
      blocker(
        "REEL_CARD_ACCENT",
        fieldPath,
        marks % 2 !== 0 ? "An accent marker is left open." : "The card has more than one accent.",
        'Mark at most one accent, closed: "Hot water on **bulgur?**".',
      ),
    );
  }
  if (words.length > L.maxCardWords) {
    issues.push(
      blocker(
        "REEL_CARD_WORDS",
        fieldPath,
        `The card has ${words.length} words, the limit is ${L.maxCardWords}.`,
        `Cut the card to ${L.maxCardWords} words or fewer.`,
      ),
    );
  }
  if (plain.length > L.maxCardChars) {
    issues.push(
      blocker(
        "REEL_CARD_LENGTH",
        fieldPath,
        `The card has ${plain.length} characters, the limit is ${L.maxCardChars}.`,
        `Shorten the card to ${L.maxCardChars} characters or fewer.`,
      ),
    );
  }
  const long = words.find((w) => w.length > L.maxCardWordChars);
  if (long) {
    issues.push(
      blocker(
        "REEL_CARD_WORD_LENGTH",
        fieldPath,
        `"${long}" is longer than ${L.maxCardWordChars} characters and will not fit a line.`,
        "Use a shorter word.",
      ),
    );
  }
  return issues;
}

/** Lowercase words of 4 letters or more without accents, for the echo of the hook in the ending. */
const STOP_WORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "your",
  "what",
  "when",
  "para",
  "como",
  "pero",
  "esto",
  "esta",
  "este",
  "tiene",
]);
function contentWords(card: string): Set<string> {
  return new Set(
    stripEmphasis(card)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w)),
  );
}

// --- the script ------------------------------------------------------------------------------

const CAMERA_MOVE =
  /(?<![\p{L}\d])(?:zoom\w*|push[- ]?in|dolly\w*|orbit\w*|tracking|camera (?:moves?|pans?|tilts?|follows?|rotates?|circles?)|pans? (?:left|right|across|over)|tilts? (?:up|down))(?![\p{L}\d])/iu;
const PEOPLE =
  /(?<![\p{L}\d])(?:person|people|man|men|woman|women|child|children|chef|face|faces|hand|hands|finger|fingers|arm|arms)(?![\p{L}\d])/iu;
const TEXT_IN_SHOT =
  /(?<![\p{L}\d])(?:text|words?|logos?|writing|letters?|captions?|subtitles?)(?![\p{L}\d])/iu;

function checkShotPrompt(prompt: string, fieldPath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const hint =
    'Write "Static camera." and then one concrete motion of the food, a tool or the water; no camera movement, text, people or hands.';
  if (!/^static camera\b/iu.test(prompt.trim())) {
    issues.push(
      blocker(
        "REEL_SHOT_PROMPT",
        fieldPath,
        'The shot prompt does not start with "Static camera."',
        hint,
      ),
    );
  }
  if (prompt.trim().split(/\s+/u).length < 6) {
    issues.push(
      blocker("REEL_SHOT_PROMPT", fieldPath, "The shot prompt names no concrete motion.", hint),
    );
  }
  for (const [pattern, what] of [
    [CAMERA_MOVE, "a camera movement"],
    [PEOPLE, "a person or a hand"],
    [TEXT_IN_SHOT, "text or a logo"],
  ] as const) {
    const match = pattern.exec(prompt);
    if (match) {
      issues.push(
        blocker(
          "REEL_SHOT_PROMPT",
          fieldPath,
          `The shot prompt contains ${what}: "${match[0]}".`,
          hint,
        ),
      );
    }
  }
  return issues;
}

function checkStructure(output: Output): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { scenes } = output;
  if (scenes.length < L.minScenes || scenes.length > L.maxScenes) {
    issues.push(
      blocker(
        "REEL_SCENE_COUNT",
        "scenes",
        `The Reel has ${scenes.length} scenes, it needs ${L.minScenes}–${L.maxScenes}.`,
        `Use between ${L.minScenes} and ${L.maxScenes} scenes.`,
      ),
    );
  }
  const ids = new Set<string>();
  for (const [i, scene] of scenes.entries()) {
    if (ids.has(scene.id)) {
      issues.push(
        blocker(
          "REEL_SCENE_ID",
          `scenes.${i}.id`,
          `The scene id "${scene.id}" is repeated.`,
          "Give every scene its own id.",
        ),
      );
    }
    ids.add(scene.id);
    const beatsOk =
      scene.beats >= L.minBeats && scene.beats <= L.maxBeats && Number.isInteger(scene.beats * 2);
    if (!beatsOk) {
      issues.push(
        blocker(
          "REEL_BEATS",
          `scenes.${i}.beats`,
          `${scene.beats} beats is not on the grid: ${L.minBeats} to ${L.maxBeats} in steps of 0.5.`,
          `Use ${L.minBeats}, ${L.minBeats + 0.5} … ${L.maxBeats} beats.`,
        ),
      );
    }
  }
  const seconds = scenes.reduce((sum, s) => sum + s.beats, 0) * L.secondsPerBeat;
  if (seconds < L.minSeconds || seconds > L.maxSeconds) {
    issues.push(
      blocker(
        "REEL_DURATION",
        "scenes",
        `The Reel lasts ${seconds} s (${seconds / L.secondsPerBeat} beats), it needs ${L.minSeconds}–${L.maxSeconds} s.`,
        `Change the beats so that the total is ${L.minSeconds / L.secondsPerBeat}–${L.maxSeconds / L.secondsPerBeat}.`,
      ),
    );
  }
  const roles = scenes.map((s) => s.role);
  const count = (role: Scene["role"]) => roles.filter((r) => r === role).length;
  const last = scenes.at(-1);
  const problems = [
    roles[0] !== "HOOK" || count("HOOK") !== 1 ? "exactly one HOOK scene, and it comes first" : "",
    roles[1] !== "RULE" || count("RULE") !== 1
      ? "exactly one RULE scene, right after the hook"
      : "",
    count("STEP") < 1 ? "at least one STEP scene" : "",
    count("PEAK") !== 1 ? "exactly one PEAK scene" : "",
    last && last.role !== "PAYOFF" && last.role !== "CTA" ? "an ending that is PAYOFF or CTA" : "",
    count("CTA") > 1 ? "at most one CTA scene" : "",
  ].filter(Boolean);
  if (problems.length > 0) {
    issues.push(
      blocker(
        "REEL_ROLES",
        "scenes",
        `The scene roles are wrong: they need ${problems.join("; ")}.`,
        "Order: HOOK, RULE, STEP scenes, one PEAK, PAYOFF, ending with CTA (or PAYOFF with the ask).",
      ),
    );
  }
  if (new Set(scenes.map((s) => s.emotion)).size < 3) {
    issues.push(
      major(
        "REEL_EMOTION_VARIETY",
        "scenes",
        "The scenes use fewer than three different emotions.",
        "Give the scenes a path: doubt or intrigue, then aha, appetite at the peak, usefulness or save-it at the end.",
      ),
    );
  }
  return issues;
}

function checkHooks(output: Output, context: ReelValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { hookOptions, scenes } = output;
  if (hookOptions.length !== L.hookOptions) {
    issues.push(
      blocker(
        "REEL_HOOK_COUNT",
        "hookOptions",
        `${hookOptions.length} hook options, it needs ${L.hookOptions}.`,
        `Give exactly ${L.hookOptions} options.`,
      ),
    );
  }
  const types = hookOptions.map((h) => h.hookType);
  if (new Set(types).size !== types.length) {
    issues.push(
      blocker(
        "REEL_HOOK_TYPES_DIFFER",
        "hookOptions",
        "Two hook options have the same hook type.",
        "Use a different hook type for every option.",
      ),
    );
  }
  const ids = new Set<string>();
  for (const [i, hook] of hookOptions.entries()) {
    const at = `hookOptions.${i}`;
    if (ids.has(hook.id)) {
      issues.push(
        blocker(
          "REEL_HOOK_ID",
          `${at}.id`,
          `The hook id "${hook.id}" is repeated.`,
          "Give every option its own id.",
        ),
      );
    }
    ids.add(hook.id);
    if (!context.hookTypes.has(hook.hookType)) {
      issues.push(
        blocker(
          "REEL_HOOK_TYPE_UNKNOWN",
          `${at}.hookType`,
          `"${hook.hookType}" is not a hook type of the taxonomy.`,
          "Use a code from <taxonomy>.",
        ),
      );
    }
    if (hook.claimSlideIds.length === 0) {
      issues.push(
        blocker(
          "REEL_HOOK_CLAIM_MISSING",
          `${at}.claimSlideIds`,
          "The rule card of the option cites no slide.",
          "Cite the slides the rule card's claim comes from.",
        ),
      );
    }
    issues.push(
      ...checkCard(hook.card, `${at}.card`),
      ...checkCard(hook.ruleCard, `${at}.ruleCard`),
    );
  }
  const chosen = hookOptions.find((h) => h.id === output.chosenHookId);
  if (!chosen) {
    issues.push(
      blocker(
        "REEL_CHOSEN_HOOK",
        "chosenHookId",
        `"${output.chosenHookId}" is not one of the hook options.`,
        "Choose one of the option ids.",
      ),
    );
    return issues;
  }
  const [first, second] = scenes;
  if (first && first.card !== chosen.card) {
    issues.push(
      blocker(
        "REEL_HOOK_CARD_MISMATCH",
        "scenes.0.card",
        "Scene 1 does not carry the chosen hook's card.",
        `Scene 1's card is exactly: ${chosen.card}`,
      ),
    );
  }
  if (second && second.card !== chosen.ruleCard) {
    issues.push(
      blocker(
        "REEL_HOOK_CARD_MISMATCH",
        "scenes.1.card",
        "Scene 2 does not carry the chosen hook's rule card.",
        `Scene 2's card is exactly: ${chosen.ruleCard}`,
      ),
    );
  }
  const ending = scenes.at(-1);
  if (ending) {
    const shared = [...contentWords(ending.card)].some((w) => contentWords(chosen.card).has(w));
    if (!shared) {
      issues.push(
        blocker(
          "REEL_ECHO",
          `scenes.${scenes.length - 1}.card`,
          "The last card does not echo a word of the hook card.",
          `Reuse a word of "${stripEmphasis(chosen.card)}" in the last card.`,
        ),
      );
    }
  }
  return issues;
}

function checkClaimsAndNumbers(output: Output, context: ReelValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const steps = output.scenes.filter((s) => s.role === "STEP").length;
  const unknown = (ids: readonly string[]) => ids.filter((id) => !context.slides.has(id));

  const checkNumbers = (card: string, claims: readonly string[], fieldPath: string) => {
    const texts = claims.flatMap((id) => context.slides.get(id) ?? []);
    const plain = stripEmphasis(card);
    for (const issue of checkNumericFidelity(
      [{ fieldPath, text: plain }],
      { texts, textLocale: context.locale },
      { locale: context.locale },
    )) {
      issues.push({ ...issue, message: issue.message.replace("cited cards", "cited slides") });
    }
    const allowed = new Set(texts.flatMap((t) => integersIn(t)));
    for (const n of integersIn(withoutUnitNumbers(plain, context.locale))) {
      if (n === 1 || n === steps || allowed.has(n)) continue;
      issues.push(
        blocker(
          "REEL_NUMBER_UNSUPPORTED",
          fieldPath,
          `The card says ${n}, which is on none of the cited slides and is not the number of STEP scenes (${steps}).`,
          "Use a number from a cited slide, or drop the number.",
        ),
      );
    }
  };

  for (const [i, scene] of output.scenes.entries()) {
    const at = `scenes.${i}`;
    const bad = unknown(scene.claimSlideIds);
    if (bad.length > 0) {
      issues.push(
        blocker(
          "REEL_CLAIM_UNKNOWN",
          `${at}.claimSlideIds`,
          `Unknown slide ids: ${bad.join(", ")}.`,
          "Cite slides of the carousel by their ids.",
        ),
      );
    }
    if (["RULE", "STEP", "PEAK"].includes(scene.role) && scene.claimSlideIds.length === 0) {
      issues.push(
        blocker(
          "REEL_CLAIM_MISSING",
          `${at}.claimSlideIds`,
          `A ${scene.role} scene cites no slide.`,
          "Cite the slides this scene's claim comes from.",
        ),
      );
    }
    checkNumbers(scene.card, scene.claimSlideIds, `${at}.card`);
  }
  for (const [i, hook] of output.hookOptions.entries()) {
    const bad = unknown(hook.claimSlideIds);
    if (bad.length > 0) {
      issues.push(
        blocker(
          "REEL_CLAIM_UNKNOWN",
          `hookOptions.${i}.claimSlideIds`,
          `Unknown slide ids: ${bad.join(", ")}.`,
          "Cite slides of the carousel by their ids.",
        ),
      );
    }
    checkNumbers(hook.card, hook.claimSlideIds, `hookOptions.${i}.card`);
    checkNumbers(hook.ruleCard, hook.claimSlideIds, `hookOptions.${i}.ruleCard`);
  }
  return issues;
}

function checkWording(output: Output, context: ReelValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const language = hookLanguage(context.locale.split("-")[0] ?? "");
  const forbidden = compileForbiddenPatterns(context.forbiddenPatterns);
  const cards = [
    ...output.hookOptions.flatMap((h, i) => [
      { fieldPath: `hookOptions.${i}.card`, text: stripEmphasis(h.card) },
      { fieldPath: `hookOptions.${i}.ruleCard`, text: stripEmphasis(h.ruleCard) },
    ]),
    ...output.scenes.map((s, i) => ({
      fieldPath: `scenes.${i}.card`,
      text: stripEmphasis(s.card),
    })),
  ];
  for (const { fieldPath, text } of cards) {
    if (language) {
      for (const { match } of findBannedHookPatterns(text, language)) {
        issues.push(
          blocker(
            "REEL_BANNED_PATTERN",
            fieldPath,
            `"${match}" promises or claims what the slides do not support.`,
            `Rewrite without "${match}": no invented experience, guarantee, conspiracy framing, time promise or empty hype.`,
          ),
        );
      }
    }
    for (const { pattern, regex } of forbidden) {
      const match = regex.exec(text.normalize("NFC"));
      if (match) {
        issues.push(
          blocker(
            "FORBIDDEN_PATTERN",
            fieldPath,
            `"${match[0]}" is not allowed for this market: ${pattern.reason}.`,
            `Rephrase without "${match[0]}".`,
          ),
        );
      }
    }
  }
  return issues;
}

function checkScenes(output: Output, context: ReelValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [i, scene] of output.scenes.entries()) {
    const at = `scenes.${i}`;
    issues.push(
      ...checkCard(scene.card, `${at}.card`),
      ...checkShotPrompt(scene.shotPrompt, `${at}.shotPrompt`),
    );
    if (!context.pictureIds.has(scene.sourcePictureId)) {
      issues.push(
        blocker(
          "REEL_PICTURE_UNKNOWN",
          `${at}.sourcePictureId`,
          `"${scene.sourcePictureId}" is not a picture of the carousel.`,
          "Use a picture id from <pictures>.",
        ),
      );
    }
    const previous = output.scenes[i - 1];
    if (previous && previous.sourcePictureId === scene.sourcePictureId) {
      issues.push(
        major(
          "REEL_PICTURE_REPEAT",
          `${at}.sourcePictureId`,
          "Two scenes in a row start from the same picture.",
          "Use a different picture for the next scene, or a different order.",
        ),
      );
    }
  }
  return issues;
}

function checkBase(output: Output, context: ReelValidationContext): ValidationIssue[] {
  const base = context.baseScript;
  if (!base) return [];
  const issues: ValidationIssue[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (output.scenes.length !== base.scenes.length) {
    issues.push(
      blocker(
        "REEL_BASE_CHANGED",
        "scenes",
        `The base script has ${base.scenes.length} scenes, this one ${output.scenes.length}.`,
        "Keep the scenes of the base script and write only the cards.",
      ),
    );
  }
  for (const [i, baseScene] of base.scenes.entries()) {
    const scene = output.scenes[i];
    if (!scene) continue;
    const { card: _baseCard, ...locked } = baseScene;
    const { card: _card, ...current } = scene;
    if (!same(locked, current)) {
      issues.push(
        blocker(
          "REEL_BASE_CHANGED",
          `scenes.${i}`,
          `Scene ${i + 1} differs from the base script in more than its card.`,
          "Copy id, role, emotion, beats, shot prompt, picture, layout and claim slides unchanged; change only the card.",
        ),
      );
    }
  }
  const chosen = output.hookOptions.find((h) => h.id === output.chosenHookId);
  if (chosen && chosen.hookType !== base.chosenHookType) {
    issues.push(
      blocker(
        "REEL_BASE_CHANGED",
        "chosenHookId",
        `The chosen hook has the type ${chosen.hookType}, the base script's is ${base.chosenHookType}.`,
        "Choose the hook option with the base script's hook type.",
      ),
    );
  }
  return issues;
}

export function validateReelScript(
  output: Output,
  context: ReelValidationContext,
): ValidationIssue[] {
  return [
    ...checkStructure(output),
    ...checkHooks(output, context),
    ...checkScenes(output, context),
    ...checkClaimsAndNumbers(output, context),
    ...checkWording(output, context),
    ...checkBase(output, context),
  ];
}
