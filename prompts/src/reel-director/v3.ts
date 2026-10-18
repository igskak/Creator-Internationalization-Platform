import { definePrompt } from "../define";
import v2, { ReelDirectorInputV2, ReelDirectorOutputV2, reelDirectorV2OutputFor } from "./v2";

// reel-director@3 (decision log 2026-10-18, "The hook shot is the most dynamic one"): reel-director@2
// with one change, in the HOOK scene. The first Reel kept viewers about 2 s; a local re-cut showed
// that its hook shot (scene s1: ice cubes and water bobbing beside pieces of chocolate) hardly moved,
// while the same calm hook on the shot of a ribbon of chocolate falling from a spoon held the eye. So
// the hook scene now takes the most dynamic, appetizing picture of the carousel and a shot that names
// a strong motion (a pour, a sizzle, a stir), never a flat lay of ingredients. The deterministic half
// of the rule is `checkHookMotion` in modules/src/reels/director/validate.ts. The flash opener is
// asked for OFF (the code already forces it, owner decision of the same day). Input and output are
// v2's. A released version file is never edited: change it in v4.ts.

const rules = v2.system[1]?.text;
if (!rules) throw new Error("reel-director@2 has changed shape.");

const HOOK_SCENE =
  "Scene 1 has the role HOOK: motion in the first frame and the chosen hook's card.";
const PICTURE =
  "- \"sourcePictureId\" is the picture the shot starts from, an id from <pictures> that shows the scene's subject. Use a different picture from the previous scene's. A picture may be used again later with a different motion.";
const FLASH_ON =
  '"flashOpener": ON puts four very short flash shots under the hook card in the first second, so the viewer sees motion before they decide to stay. Use ON by default; OFF only when the hook shot itself opens on strong motion.';
for (const anchor of [HOOK_SCENE, PICTURE, FLASH_ON]) {
  if (!rules.includes(anchor)) throw new Error("reel-director@2 has changed shape.");
}

const HOOK_SHOT = `- The HOOK scene is the one shot a cold viewer sees before deciding to stay, so it is the most dynamic and appetizing shot of the whole Reel. Its "sourcePictureId" is the picture of <pictures> that shows the strongest motion or the most appetizing texture: a pour, a stream or a ribbon falling, sizzling, stirring, bubbling, melting, drizzling. Take it from any slide of the carousel, even a later one: the card carries the doubt, the picture carries the appetite. Never start the hook from a near-still picture of ingredients: a flat lay, items lying side by side, a bowl or a board of raw pieces, ice or objects floating in water. If the PEAK scene's picture is the most dynamic one, the hook may start from it; the PEAK scene then uses another picture or another motion.
- The HOOK scene's "shotPrompt" names one strong motion of the food, the liquid or a tool, with a verb such as pour, stream, fall, sizzle, stir, whisk, drizzle, splash, bubble, boil, melt, crack, toss or fry, and says what moves and where it goes ("Melted chocolate falls from a spoon in a thick ribbon into the bowl."). Steam rising, drifting, floating, bobbing, settling or resting is not a strong motion: it may come second in the sentence, never alone.`;

const DIRECTOR_RULES = rules
  .replace(
    HOOK_SCENE,
    `${HOOK_SCENE} It is the most dynamic picture and motion of the carousel (see Shots).`,
  )
  .replace(PICTURE, `${PICTURE}\n${HOOK_SHOT}`)
  .replace(
    FLASH_ON,
    '"flashOpener": OFF. The hook scene is held on its own, with its card from the first frame; the flash shots are not used.',
  );

export default definePrompt({
  id: "reel-director",
  version: 3,
  stage: "REEL_DIRECTION",
  input: ReelDirectorInputV2,
  output: ReelDirectorOutputV2,
  outputFor: reelDirectorV2OutputFor,
  defaults: v2.defaults,
  system: [
    { text: v2.system[0]?.text ?? "", cache: false },
    { text: DIRECTOR_RULES, cache: true },
  ],
  render: v2.render,
  renderTemplate: v2.renderTemplate ?? "",
  changelog:
    "The HOOK scene takes the most dynamic, appetizing picture of the carousel and a shot prompt with a strong motion verb (pour, sizzle, stir, fall), never a near-still flat lay of ingredients; validated by checkHookMotion. flashOpener is asked for OFF (the flash opener was dropped on 2026-10-18). Everything else is v2's.",
});
