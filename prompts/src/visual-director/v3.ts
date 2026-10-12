import { definePrompt } from "../define";
import v2 from "./v2";

// visual-director@3: visual-director@2 with the photography of the carousel style
// (docs/design/carousel-style.md): large macro subjects cut out on pure white, cropped by the frame,
// with the empty side the templates put the text on. v2 asked for "lots of whitespace", which gave
// small subjects on grey stone. Input, output and rendering are those of v2. A released version
// file is never edited: change it in v4.ts.

const VISUAL_DNA = `# Visual DNA
Premium macro studio food photography cut out on white, the same on every slide of the carousel. One subject per picture, large and close: it fills most of its part of the frame and is cropped by the frame's edges, never small and floating in the middle. Pure white seamless background (#FFFFFF), high-key soft diffused studio light, a gentle contact shadow under the subject, shallow depth of field, saturated natural colours, crisp texture. Materials: the food itself, brushed stainless steel, clear glass. No wooden tables, stone, slate, linen, cutting boards, plates as props or extra objects. The slide's text never sits on the picture: the template puts the picture beside the text, so the empty part of the frame must stay pure white.

# Composition by slot
- Template A, slot "hero" (full-bleed cover): the subject fills the upper two thirds of the frame and may be cropped by the side; the bottom third is calm and simple, the headline goes there over a dark shade.
- Templates B, D, E and F, slots "side", "image" and "product": the subject sits in the right 60% and lower part of the frame and is cropped by the right edge and the bottom edge. Write in the prompt, in these words: "The left 40% of the frame, top to bottom, is completely empty pure white."
- Template C, slots "before" and "after": one subject each, centred, with white all around, the same size, angle and light in both; the template cuts each picture at the edge of the slide.
- Every prompt ends with: "Isolated on a pure white seamless background (#FFFFFF), high-key soft diffused studio light, shallow depth of field, saturated natural colors, crisp texture detail. No text."`;

const NEGATIVE =
  "text, letters, numbers, logo, watermark, label, printed packaging, gray stone surface, rustic wooden table, cutting board, linen, dark background, colored backdrop, clutter, props, hands, people, faces, harsh flash, distorted food, extra objects, frame, border, vignette";

const [dataRules, rules] = v2.system;
if (!dataRules || !rules) throw new Error("visual-director@2 has changed shape.");

const replacements: [string | RegExp, string][] = [
  [/# Visual DNA\n[^\n]+/u, VISUAL_DNA],
  [
    " Keep the area where the slide's text goes calm and uncluttered. Do not ask for people's faces or hands unless the slide needs a hand doing the technique, and then describe it simply.",
    ' Follow "# Composition by slot" for the slot. No people, faces or hands.',
  ],
  [
    "for example text, logos, packaging, extra fingers, distorted hands, clutter, harsh flash.",
    `always at least: ${NEGATIVE}.`,
  ],
];
let DIRECTOR_RULES = rules.text;
for (const [from, to] of replacements) {
  const next = DIRECTOR_RULES.replace(from, to);
  if (next === DIRECTOR_RULES) throw new Error("visual-director@2 has changed shape.");
  DIRECTOR_RULES = next;
}

export default definePrompt({
  id: "visual-director",
  version: 3,
  stage: "VISUAL_DIRECTION",
  input: v2.input,
  output: v2.output,
  ...(v2.outputFor ? { outputFor: v2.outputFor } : {}),
  defaults: v2.defaults,
  system: [{ ...dataRules }, { ...rules, text: DIRECTOR_RULES }],
  render: v2.render,
  ...(v2.renderTemplate ? { renderTemplate: v2.renderTemplate } : {}),
  changelog:
    "Macro subjects cut out on pure white, cropped by the frame, with the empty side per template slot and a fixed negative list.",
});
