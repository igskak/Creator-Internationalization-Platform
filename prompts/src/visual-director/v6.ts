import { definePrompt } from "../define";
import v5 from "./v5";

// visual-director@6: placement and arrangement. With v5 every inner picture sat in the lower right
// corner, so the slides looked alike even with varied subjects. The reference carousels move the
// picture (top right, a column down the right side, a band along the bottom, the corner) and build
// the frame from one to three elements (a hero with small accents, a sequence of stages, two states,
// a line-up). A placement test on 2026-10-13 showed the image model keeps all four placements.
// The code adds the placement's composition to the prompt and the template moves the picture to the
// same place. Input, output and rendering are those of v5 plus `placement` and `arrangement`. A
// released version file is never edited: change it in v7.ts.

const PLACEMENT_AND_ARRANGEMENT = `# Placement and arrangement
On the inner slides (templates B, D, E and F) the picture does not always sit in the same place. Give each of their pictures a "placement"; the system adds the matching composition to the prompt and the template moves the picture there:
- CORNER: lower right, cropped by the right and bottom edges. A single subject seen from the side.
- TOP_RIGHT: entering from the top-right corner, cropped by the top and right edges: a spoon, a whisk, a fork lifting food, grains falling from above, small accents lower on the right.
- RIGHT_COLUMN: a tall column down the right side, top to bottom: a SEQUENCE of two or three stages one above another, TWO_STATES one above the other, or a tall subject.
- BOTTOM_BAND: a wide band across the bottom: a wide pan, a tray, a LINE_UP of ingredients or tools, a served bowl seen wide. Only on a slide with little text: at most about 140 characters besides the headline.
Two inner slides in a row never share a placement. The cover (template A) and template C keep their own composition: leave "placement" out for them.
Give each picture an "arrangement" too: HERO (one main subject), HERO_WITH_ACCENTS (one main subject and one or two small related accents, such as a droplet, a chunk, a herb leaf), SEQUENCE (two or three of the same item in order, showing the stages), TWO_STATES (the same food in two states), LINE_UP (the ingredients or tools of the step together). A carousel of five or more pictures uses at least three arrangements; describe the elements and their order in "prompt".

# Colour and contrast`;

const [dataRules, rules] = v5.system;
if (!dataRules || !rules) throw new Error("visual-director@5 has changed shape.");

const replacements: [string, string][] = [
  ["# Colour and contrast", PLACEMENT_AND_ARRANGEMENT],
  [
    '- "colorSource" (GENERATE):',
    '- "placement" (GENERATE, templates B, D, E and F only): CORNER, TOP_RIGHT, RIGHT_COLUMN or BOTTOM_BAND.\n- "arrangement" (GENERATE): HERO, HERO_WITH_ACCENTS, SEQUENCE, TWO_STATES or LINE_UP.\n- "colorSource" (GENERATE):',
  ],
];
let DIRECTOR_RULES = rules.text;
for (const [from, to] of replacements) {
  if (!DIRECTOR_RULES.includes(from)) throw new Error("visual-director@5 has changed shape.");
  DIRECTOR_RULES = DIRECTOR_RULES.replace(from, to);
}

export default definePrompt({
  id: "visual-director",
  version: 6,
  stage: "VISUAL_DIRECTION",
  input: v5.input,
  output: v5.output,
  ...(v5.outputFor ? { outputFor: v5.outputFor } : {}),
  defaults: v5.defaults,
  system: [{ ...dataRules }, { ...rules, text: DIRECTOR_RULES }],
  render: v5.render,
  ...(v5.renderTemplate ? { renderTemplate: v5.renderTemplate } : {}),
  changelog:
    "Placement of inner pictures (corner, top right, right column, bottom band) and arrangement of the frame (hero, accents, sequence, two states, line-up), with variety rules.",
});
