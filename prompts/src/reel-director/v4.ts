import { z } from "zod";
import { definePrompt } from "../define";
import { REEL_EMOTIONS, REEL_LIMITS, REEL_SCENE_ROLES, ReelDirectorScene } from "./schema";
import v2, {
  ReelDirectorInputV2,
  ReelDirectorOutputV2,
  ReelPostCta,
  reelDirectorV2OutputFor,
} from "./v2";

// reel-director@4 (decision log 2026-10-19, "Reels v4: fewer, longer shots in the account's
// style"): the owner found the Reels of v3 too fast and empty ("the picture changes quickly, the
// text carries no value, the hook is weak"; about 2 s average watch). Two hand-made test Reels
// (chicken, then stir-or-not rice) led to this format, picked by the owner on the rice test
// (variant A): 5 to 7 shots of 3 to 3.5 s, each with a card and a short line of use under it; a
// hook that names a problem the viewer recognises; a story with a logic (problem → why → steps →
// the flip side → a summary that states the whole rule); every shot starts from a picture made for
// it in the account's look (white page, high-key), with pale food in dark cookware; the video keeps
// the model's own sound. The scene gains "line" and "framePrompt". Input and post are v2's.
// A released version file is never edited: change it in v5.ts.

/** Limits of a v4 script; the validators and the prompt read them from here. */
export const REEL_LIMITS_V4 = {
  ...REEL_LIMITS,
  minScenes: 5,
  maxScenes: 7,
  minSeconds: 16,
  maxSeconds: 24,
  /** 3 to 3.5 s a scene: long enough to read the card and its line. */
  minBeats: 6,
  maxBeats: 7,
  maxLineWords: 14,
  maxLineChars: 80,
  minFramePromptWords: 8,
} as const;

export const ReelDirectorSceneV4 = ReelDirectorScene.extend({
  /** One short sentence of use under the card; "" on the hook scene. */
  line: z.string(),
  /** The start picture of the shot, in English, without the look (the system adds it). */
  framePrompt: z.string(),
});
export type ReelDirectorSceneV4 = z.infer<typeof ReelDirectorSceneV4>;

export const ReelDirectorOutputV4 = ReelDirectorOutputV2.extend({
  scenes: z.array(ReelDirectorSceneV4),
});
export type ReelDirectorOutputV4 = z.infer<typeof ReelDirectorOutputV4>;

const oneOf = (codes: readonly string[]) =>
  z.enum(codes as [string, ...string[]]) as unknown as z.ZodType<string>;

/** v2's schema for one call with v4's scenes. */
export function reelDirectorV4OutputFor(
  input: ReelDirectorInputV2,
): z.ZodType<ReelDirectorOutputV4> {
  const base = reelDirectorV2OutputFor(input) as unknown as z.ZodObject<z.ZodRawShape>;
  const slideId = oneOf(input.carousel.slides.map((s) => s.id));
  const pictureId = oneOf(input.pictures.map((p) => p.id));
  return base.extend({
    scenes: z.array(
      ReelDirectorSceneV4.extend({ sourcePictureId: pictureId, claimSlideIds: z.array(slideId) }),
    ),
    cta: ReelPostCta.extend({ type: oneOf(input.ctaTypes.map((t) => t.code)) }),
  }) as unknown as z.ZodType<ReelDirectorOutputV4>;
}

const L = REEL_LIMITS_V4;

const [dataRules, v2Rules] = v2.system;
if (!dataRules || !v2Rules) throw new Error("reel-director@2 has changed shape.");

/** One "# Heading" block of v2's rules, up to the next heading. */
function block(heading: string): string {
  const text = v2Rules?.text ?? "";
  const at = text.indexOf(`${heading}\n`);
  if (at < 0) throw new Error(`reel-director@2 has no "${heading}" block.`);
  const end = text.indexOf("\n# ", at + 1);
  return (end < 0 ? text.slice(at) : text.slice(at, end)).trimEnd();
}

const V2_PREFERENCE =
  '- A cold viewer stops for a doubt about something they already do ("Hot water on bulgur?"), answered by the rule card. When the slides support it, recommend such an option.';
const V2_NUMBERS =
  "A number or an amount in a card must appear on a slide that the scene cites, or be the count of the STEP scenes in a numbered hook.";
const hooksV2 = block("# Hooks");
const factsV2 = block("# Facts");
if (!hooksV2.includes(V2_PREFERENCE) || !factsV2.includes(V2_NUMBERS)) {
  throw new Error("reel-director@2 has changed shape.");
}

const HOOKS = hooksV2.replace(
  V2_PREFERENCE,
  '- A cold viewer stops for a problem they recognise from their own kitchen, named concretely ("Rice not fluffy?", "Tender chicken, but bland?"), or for a doubt about something they already do, answered by the rule card. When the slides support it, recommend such an option. Never a vague hook ("Something wrong with your rice?"): it names no problem the viewer can recognise.',
);
const FACTS = factsV2.replace(
  V2_NUMBERS,
  "A number or an amount in a card or a line must appear on a slide that the scene cites, or be the count of the STEP scenes in a numbered hook.",
);

const DIRECTOR_RULES = `# Task
Direct ONE Reel for ONE market from its approved carousel: a vertical video of ${L.minScenes} to ${L.maxScenes} calm shots of about three seconds, each with one big text card and one short line of use under it. The look is the account's own: the food on a pure white page, the text in dark ink with one red accent. The Reel has to stop a cold viewer in the first second, teach them one rule they can use, and end with that rule complete.

# Story
- One idea per Reel: the one claim of the carousel that is most useful, told as a path with a logic: the problem the viewer recognises, why it happens, what to do step by step, the flip side of the rule or its most sensory moment, and the summary.
- Scene 1 has the role HOOK: the chosen hook's card, a concrete problem or doubt, and a picture that shows it (the cloudy, stirred pot; the pale boiled chicken). Scene 2 has the role RULE: the chosen hook's rule card, the cause or the rule; its line says why.
- Then STEP scenes, one action each, in the order the viewer does them, each a different frame. Exactly one PEAK scene: the most sensory moment or the flip side of the rule ("Creamy? **Now stir.**").
- The last scene is the summary (role PAYOFF, or CTA): its card closes the loop with a word of the hook card, its line states the whole rule in one sentence and ends with the one ask ("Fluffy: hands off. Creamy: stir. Save this for your next pot."). A viewer who stops on the last frame has the full rule.
- Every scene adds something new; no card repeats the previous one in other words. Roles: ${REEL_SCENE_ROLES.join(", ")}.
- One emotion per scene, from: ${REEL_EMOTIONS.join(", ")}: doubt first, "aha" in the middle, appetite or surprise at the peak, usefulness or the wish to save it at the end.

# Timing
- A beat is half a second (120 BPM). "beats" of a scene is ${L.minBeats} to ${L.maxBeats} in steps of 0.5, so a shot lasts 3 to 3.5 seconds: long enough to read the card and its line. The hook scene is held ${L.maxBeats} beats.
- The whole Reel lasts ${L.minSeconds} to ${L.maxSeconds} seconds: add up the beats and check. "flashOpener": OFF.

${HOOKS}

# Cards and lines
- Text cards are read in a glance on a phone: at most ${L.maxCardWords} words, at most ${L.maxCardChars} characters, no word longer than ${L.maxCardWordChars} characters. Short, concrete, no filler, no emoji, no hashtags.
- Mark at most one accent in a card with double asterisks: one word or one short line ("Rice not fluffy? **Stop stirring.**"). No other formatting.
- "line" is one short sentence of use under the card, in smaller type: the reason, the condition or the exact action that the card leaves out ("Very low heat, lid on."). At most ${L.maxLineWords} words and ${L.maxLineChars} characters, no accent marks, no emoji, no hashtags; it never repeats the card. The HOOK scene's line is empty (""), so the question stands alone; every other scene has a line, and the last scene's line is the summary with the ask.

# Pictures
- Every shot starts from a picture made for it. "framePrompt" describes that picture in English in one or two sentences: what is in the frame, in which cookware or bowl, in what state, at the moment just before the shot's motion ("A black cast-iron pot of long-grain rice in cloudy, starchy water, a wooden spoon resting in it."). The system adds the look (a white seamless page, soft high-key light, macro detail, the subject in the lower part with the top free for the text): do not describe the background, the light or the camera.
- Pale or white food (rice, pasta, risotto, cream, milk, yogurt, potatoes, cauliflower, raw or boiled chicken, white fish, tofu, egg white, dough, flour, oats) sits in dark cookware: black cast iron, dark enamel, charcoal ceramic or dark stoneware, so that it stands out on the white page. Colourful or browned food may sit in white cookware.
- Show the state the scene talks about: the hook shows the problem, a step shows its action, the summary shows the result, side by side when the rule has two sides. One subject per frame; the same pot may come back, so the Reel feels like one kitchen.
- Never in a frame prompt: people, hands, faces, text, labels, logos, brand packaging, or a background or surface other than the white page.
- "sourcePictureId" is the carousel picture closest to the scene; it is used only when the frame cannot be made.
- "layout" is FULL: the picture fills the frame.

# Shots
- "shotPrompt" is for the video model and always in English. Start with "Static camera." then ONE concrete motion of the food, a tool or the liquid that starts from the frame (a wooden spoon stirs, stock pours, the pot boils hard), then the sound it makes ("Sound of the spoon scraping and water swishing."): the video keeps the model's own sound.
- Never in a shot prompt: camera movement (zoom, push-in, pan, tilt, orbit, tracking, dolly), text or logos, people, hands or faces, objects that are not in the frame.
- The HOOK scene's "shotPrompt" names one strong motion of the food, the liquid or a tool, with a verb such as pour, stream, fall, sizzle, stir, whisk, drizzle, splash, bubble, boil, melt, crack, toss or fry, and says what moves ("The wooden spoon stirs the rice round and round; the water turns cloudy with starch."). Steam rising, drifting or settling is not a strong motion: it may come second in the sentence, never alone.

${FACTS}

${block("# Post")}

# Language and market
- Cards, lines and hook cards are in the language of <market>, written as a native creator of that market would write them, not translated from the carousel's wording. Follow <brief>: its tone and terminology. es-ES is Spanish from Spain (tú, never Latin American); en is US English. Uppercase is applied to the cards by the design, write normal case. Frame prompts and shot prompts are always in English.
- If <base_script> is given, this Reel reuses the pictures and shots of another market's Reel. Keep its scenes exactly: same ids, order, roles, emotions, beats, shot prompts, source pictures, layouts and claim slides. Leave every "framePrompt" empty (""): the system keeps the other market's pictures. Write only the cards and the lines, in this market's language, and the hook options; the chosen hook has the hook type of the base script.

# Output
Return only the structured result.`;

export default definePrompt({
  id: "reel-director",
  version: 4,
  stage: "REEL_DIRECTION",
  input: ReelDirectorInputV2,
  output: ReelDirectorOutputV4,
  outputFor: reelDirectorV4OutputFor,
  defaults: v2.defaults,
  system: [
    { text: dataRules.text, cache: false },
    { text: DIRECTOR_RULES, cache: true },
  ],
  render: v2.render,
  renderTemplate: v2.renderTemplate ?? "",
  changelog:
    "Reels v4 (owner's pick of 2026-10-19): 5–7 shots of 3–3.5 s, a card plus a short line of use per scene, a hook that names a problem the viewer recognises, a story with a logic and a summary that states the whole rule with the ask; every shot starts from a picture made for it in the account's white look (framePrompt), pale food in dark cookware; shot prompts name the sound, the video keeps the model's audio. Input and post are v2's.",
});
