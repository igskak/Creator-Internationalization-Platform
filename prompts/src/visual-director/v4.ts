import { definePrompt } from "../define";
import { renderSections, section } from "../xml";
import v3 from "./v3";

// visual-director@4: a shot list for the whole carousel before the single pictures, the recipe of
// the idea's cards as a source of real tools, actions and ingredients, and prompts that describe
// only the subject. v3 planned each slide on its own and, told "one subject, no extra objects",
// showed a pot of grain on almost every slide. The composition of the slot, the style sentence
// and the fixed negative list are added by the code (modules/src/content/visual/photo-prompt.ts),
// so every picture of a carousel shares them word for word. Input and output schemas are those
// of v3 plus `recipe` and `shotType`. A released version file is never edited: change it in v5.ts.

const [dataRules] = v3.system;
if (!dataRules) throw new Error("visual-director@3 has changed shape.");
const TAGS =
  "(<master_idea>, <market>, <slides>, <library>, <sibling_briefs>, <visual_styles>, <task>)";
if (!dataRules.text.includes(TAGS)) throw new Error("visual-director@3 has changed shape.");
const DATA_RULES = dataRules.text.replace(
  TAGS,
  "(<master_idea>, <market>, <slides>, <recipe>, <library>, <sibling_briefs>, <visual_styles>, <task>)",
);

const DIRECTOR_RULES = `# Task
For every image slot of every slide in <slides> decide where its picture comes from and describe it. Return one entry per image slot, with "slideId" and "slot" exactly as given, and no entry for a slot that does not exist.

# Look of every picture (added by the system)
Premium macro studio food photography cut out on pure white, high-key soft light, saturated natural colours, crisp texture, the same on every slide. The system adds the background, the light, the composition of the slot (where the subject sits and which side stays empty for the text) and the negative list to every prompt. You choose and describe what is in the frame.

# Shot list first
Before describing single pictures, plan the carousel as a sequence of shots, like a food photographer's shot list for a cookbook spread. Give each picture one "shotType":
- INGREDIENT_MACRO: the ingredient itself, very close, without a vessel: a heap, scattered grains, a spoonful, a cut surface.
- TECHNIQUE_IN_ACTION: the step while it happens: water running through a strainer, grains falling into a pan, steam rising, oil shimmering, a stir.
- COMPARISON: two states side by side in one frame, split down the middle (raw and toasted, wrong and right, before and after).
- TOOL_AND_INGREDIENT: the tool of the step together with the ingredient: a measuring cup, a strainer, a spoon, a jar.
- FINISHED_DISH: the finished food, served in a bowl or packed for later, the most appetizing shot.
- IN_THE_VESSEL: the food in its pot or pan.
Pick the shot that shows what the slide teaches. Good defaults: the cover (HOOK) is FINISHED_DISH or TECHNIQUE_IN_ACTION; a MISTAKE or CORRECT slide is TECHNIQUE_IN_ACTION or COMPARISON; a STEP is TECHNIQUE_IN_ACTION or TOOL_AND_INGREDIENT; an EXPLANATION or FACT is INGREDIENT_MACRO or COMPARISON; a CTA is FINISHED_DISH.
Variety is required: two slides in a row never have the same shotType, IN_THE_VESSEL is used at most twice in the carousel, and a carousel of four or more pictures uses at least three kinds of shot.

# The recipe
<recipe> holds the steps, ingredients and usual mistakes of the cards the slides rest on. Take the real tools, actions and ingredients of the step from there (the strainer of the rinse, the measuring cup of the ratio, the oil of the toasting) even when the slide's short text does not name them. Never show a tool, an ingredient or a step that neither the slide nor <recipe> mentions, and never show the wrong way as the right one. One or two natural ingredients of the recipe may add colour to a FINISHED_DISH or COMPARISON shot (fresh herbs, a lemon, vegetables of the recipe); no decorative props.

# Rules for each picture
- "source": GENERATE (a new image is generated from "prompt"), LIBRARY (a photo from <library>, give its id as "libraryAssetId") or NONE (only for an optional slot that is better left empty). Required slots (required="true") are never NONE. Prefer a library photo when one really fits the slide and the carousel; otherwise generate. Use a library id only if it is listed in <library>.
- "shotType" (GENERATE): the kind of shot from the shot list.
- "prompt" (GENERATE): one or two English sentences of the subject and the action only: what is in the frame, what is happening, the camera distance and angle, the detail that makes it appetizing (droplets, steam, glistening grains, a golden edge). Do not describe the background, the light, the style or where the subject sits in the frame: the system adds them. No text, letters, numbers, logos, watermarks, packaging or brand names. No people, faces or hands.
- "negativePrompt" (GENERATE): only what this picture in particular risks (for example "burnt grains, oil splatter"), or an empty string; the system adds the fixed list. Empty for LIBRARY and NONE.
- "composition": one short sentence for the reviewer: the shot and why it fits the slide.
- "aspect": the aspect of the slot as given in <slides> ("4:5" for a full slide, "1:1" for a square). For a slot of another aspect use the closest of 4:5, 1:1, 3:4, 16:9.
- Template C ("before" and "after"): each picture has one subject, centred, and the two match in size, angle and light so they read as a pair; the template places them at the two edges of the slide.

# Concept and style
- "concept": two or three sentences: the visual idea of the carousel and how the shot list tells the story.
- "visualStyle": a code from <visual_styles>.
- If <market> lists hypotheses, apply the most suitable one (its description and style) and give its id in "hypothesisId"; otherwise leave "hypothesisId" out.
- Compare with <sibling_briefs>: the hero picture must have a different subject framing and composition from the other markets'. In "differentiationFromSibling" say in a sentence how it differs; with no siblings write an empty string.

# Output
Return only the structured result.`;

export default definePrompt({
  id: "visual-director",
  version: 4,
  stage: "VISUAL_DIRECTION",
  input: v3.input,
  output: v3.output,
  ...(v3.outputFor ? { outputFor: v3.outputFor } : {}),
  defaults: v3.defaults,
  system: [
    { text: DATA_RULES, cache: false },
    { text: DIRECTOR_RULES, cache: true },
  ],
  render: (input) => [
    {
      type: "text",
      text: renderSections(
        section("master_idea", section("core_message", input.idea.coreMessage), {
          topic: input.idea.topic,
        }),
        section(
          "market",
          input.market.hypotheses.map((h) =>
            section("hypothesis", h.description, {
              id: h.id,
              visual_style: h.visualStyle,
              status: h.status,
            }),
          ),
          { code: input.market.code, name: input.market.displayName },
        ),
        section(
          "slides",
          input.slides.map((s) =>
            section(
              "slide",
              [
                ...s.slots.map((slot) => section("text", slot.text, { slot: slot.name })),
                ...s.imageSlots.map((slot) =>
                  section("image_slot", "", {
                    name: slot.name,
                    aspect: slot.aspect,
                    required: slot.required,
                  }),
                ),
              ],
              { id: s.slideId, n: s.index + 1, role: s.role, template: s.templateId },
            ),
          ),
        ),
        section(
          "recipe",
          input.recipe.map((card) =>
            section(
              "card",
              [
                section("claim", card.claim),
                ...card.steps.map((step, i) => section("step", step, { n: i + 1 })),
                ...card.ingredients.map((ingredient) => section("ingredient", ingredient)),
                ...card.mistakes.map((mistake) => section("mistake", mistake)),
              ],
              { id: card.id, title: card.title },
            ),
          ),
        ),
        section(
          "library",
          input.libraryCandidates.map((p) =>
            section("photo", p.description, { id: p.id, tags: p.tags.join(", ") || undefined }),
          ),
        ),
        section(
          "sibling_briefs",
          input.siblingBriefs.map((b) =>
            section(
              "brief",
              b.compositions.map((c) => section("composition", c)),
              {
                market: b.marketCode,
                style: b.visualStyle,
                concept: b.concept,
              },
            ),
          ),
        ),
        section(
          "visual_styles",
          input.visualStyles.map((t) => section("style", t.label, { code: t.code })),
        ),
        section(
          "task",
          `Plan the shot list and the pictures of the carousel for the market ${input.market.code} (${input.market.displayName}).`,
        ),
      ),
    },
  ],
  renderTemplate:
    "<master_idea topic><core_message> <market code name><hypothesis id visual_style status>…> <slides><slide id n role template><text slot>…<image_slot name aspect required>…> <recipe><card id title><claim><step n>…<ingredient>…<mistake>…> <library><photo id tags>…> <sibling_briefs><brief market style concept><composition>…> <visual_styles><style code>…> <task>",
  changelog:
    "Shot list with shotType and variety rules, the cards' recipe as input, and prompts of the subject only (the system adds composition, style and the negative list).",
});
