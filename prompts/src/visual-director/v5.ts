import { definePrompt } from "../define";
import v4 from "./v4";

// visual-director@5: colour and visible action. The first live run of v4 (an English carousel
// about rescuing grains that came out too wet, 2026-10-13) planned a varied shot list, but every
// picture was white rice on white: the recipe had no colourful ingredient, props were forbidden,
// and several shots rested on steam, clear water or a starch film, which do not show on white.
// v5 asks for a colour accent on at least half of the pictures (from the recipe, or a serving
// suggestion on the cover and the finished dish only), contrast for pale food, a visible action
// or texture in every frame, and a split frame for comparisons (the code adds that composition).
// Input, output and rendering are those of v4 plus `colorAccent` and `colorSource`. A released
// version file is never edited: change it in v6.ts.

const COLOUR_AND_ACTION = `# Colour and contrast
White food on a white page is a blank slide. At least half of the generated pictures carry a clear colour accent; name it in "colorAccent" and say where it comes from in "colorSource":
- RECIPE: an ingredient, a tool or a result of <recipe> or of the slide (golden toasted grains, green peas of the recipe, a lemon the recipe uses). Any picture may use it.
- SERVING: a classic serving partner that the recipe does not name (fresh herbs, a lemon wedge, a few cherry tomatoes, a fried egg). Only on the cover and on FINISHED_DISH shots, and never so that it looks like a step of the recipe.
Pale food (rice, quinoa, pasta, oats, dough) needs contrast in every picture: put it in or on one vessel of a strong colour (black cast iron, a deep-coloured or dark ceramic bowl) or give it the colour accent. Brushed steel and clear glass alone do not make contrast for pale food.

# Visible action
Every picture shows something visible happening or a visible texture: a spoon lifting a clump, a fork fluffing the grains, grains falling from a spoon, a golden crust, droplets on steel, a glossy sauce. Steam, clear water and a thin starch film barely show on white: never make them the point of a picture. A COMPARISON is one frame split down the middle into two equal halves with the same angle and light; the system adds that split to the composition.

# The recipe`;

const [dataRules, rules] = v4.system;
if (!dataRules || !rules) throw new Error("visual-director@4 has changed shape.");

const replacements: [string, string][] = [
  ["# The recipe", COLOUR_AND_ACTION],
  [
    " One or two natural ingredients of the recipe may add colour to a FINISHED_DISH or COMPARISON shot (fresh herbs, a lemon, vegetables of the recipe); no decorative props.",
    " No decorative props: a colour accent is food, a tool of the recipe or the vessel itself (see # Colour and contrast).",
  ],
  [
    '- "shotType" (GENERATE): the kind of shot from the shot list.',
    '- "shotType" (GENERATE): the kind of shot from the shot list.\n- "colorAccent" (GENERATE): the colour accent of the picture in a few English words ("black cast-iron skillet", "chopped parsley"), or an empty string when it has none.\n- "colorSource" (GENERATE): RECIPE or SERVING for a picture with a colour accent; leave it out when "colorAccent" is empty.',
  ],
];
let DIRECTOR_RULES = rules.text;
for (const [from, to] of replacements) {
  if (!DIRECTOR_RULES.includes(from)) throw new Error("visual-director@4 has changed shape.");
  DIRECTOR_RULES = DIRECTOR_RULES.replace(from, to);
}

export default definePrompt({
  id: "visual-director",
  version: 5,
  stage: "VISUAL_DIRECTION",
  input: v4.input,
  output: v4.output,
  ...(v4.outputFor ? { outputFor: v4.outputFor } : {}),
  defaults: v4.defaults,
  system: [{ ...dataRules }, { ...rules, text: DIRECTOR_RULES }],
  render: v4.render,
  ...(v4.renderTemplate ? { renderTemplate: v4.renderTemplate } : {}),
  changelog:
    "Colour accent on at least half of the pictures (recipe, or serving suggestion on cover and finished dish), contrast for pale food, a visible action in every frame, split frame for comparisons.",
});
