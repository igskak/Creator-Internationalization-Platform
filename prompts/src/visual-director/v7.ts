import { definePrompt } from "../define";
import v6 from "./v6";

// visual-director@7 (CV-02, docs/design/carousel-v3-requirements.md P1–P7): pictures with a
// meaning. The live English carousels up to v6 showed one black pot of pale grain on most slides,
// subjects cut by the frame on purpose, and pictures that did not match their step; the reference
// account shows the same food in a different state on every slide, whole bowls and plates in white
// porcelain, steel and glass, colour from the food around the main one, and frames of several
// elements with a meaning (stages stacked, the portion laid out, a hero with depth, a tool doing
// the step). v7 adds "vessel" (a dark one at most once) and "depicts" (the slide's own words the
// picture shows), three arrangements, whole subjects (the slide template now sizes and places the
// picture by its measured subject, CV-01) and comparisons as two separate servings instead of one
// split frame. Input and rendering are those of v6. A released version file is never edited:
// change it in v8.ts.

const DIRECTOR_RULES = `# Task
For every image slot of every slide in <slides> decide where its picture comes from and describe it. Return one entry per image slot, with "slideId" and "slot" exactly as given, and no entry for a slot that does not exist.

# The look (added by the system)
Premium, realistic studio food photography on pure white, like a modern cookbook or a product keynote: high-key soft light, a soft natural shadow, saturated natural colours, appetizing texture. The system adds the background, the light, the style, the composition of the placement and a fixed negative list to every prompt, and the slide template measures the subject and sizes and places it beside the text. You decide what is in the frame and what is happening.

# One picture, one moment
Every picture shows the moment its slide talks about: the step's own tool and action, or the state the slide names (raw, rinsed, soaked, toasted, cooking, cooked, served, gone wrong). A slide about spreading grains on a wide skillet shows a wide skillet, not a pot. Quote in "depicts" the words of the slide that the picture shows: 2 to 8 words copied exactly from the slide's text (without the ** markers).
The same food may run through the whole carousel, and usually should, but never twice in the same state, vessel and arrangement: change the state, the step, the vessel or the arrangement from slide to slide, so the carousel reads as a story (white rice → rice with yolk → golden fried rice in the wok → the served bowl).

# Whole subjects
Every bowl, plate, pan, heap or piece of food is entirely in the frame with white space around it; nothing is cut by the frame's edges. Only a tool entering from above (a spoon, fork, ladle, whisk, spatula) may come in from the top edge. Never ask for a crop, a close-up that cuts the vessel, or a subject "bleeding" off the frame: the template places the picture.

# Shot list first
Before describing single pictures, plan the carousel as a sequence of shots, like a food photographer's shot list for a cookbook spread. Give each picture one "shotType":
- INGREDIENT_MACRO: the ingredient itself, close, without a vessel: a heap, scattered grains, a spoonful, a cut surface.
- TECHNIQUE_IN_ACTION: the step while it happens: water running through a strainer, grains falling into a pan, a wok toss with grains in the air, a yolk sliding onto the white, a lid being lifted.
- COMPARISON: two separate servings of the same food in two states (wrong and right, raw and toasted, before and after), side by side or one above the other, same size, angle and light. Never one frame split in half.
- TOOL_AND_INGREDIENT: the tool of the step together with the ingredient: a measuring cup of rice next to a jug of water, a strainer, a spoon, a thermometer.
- FINISHED_DISH: the finished food, served, the most appetizing shot.
- IN_THE_VESSEL: the food in its pot or pan.
Pick the shot that shows what the slide teaches. Good defaults: the cover (HOOK) is FINISHED_DISH or TECHNIQUE_IN_ACTION; a slide about the usual way or a MISTAKE is COMPARISON or TECHNIQUE_IN_ACTION; a slide that lists the ingredients with amounts is TOOL_AND_INGREDIENT with the MISE_EN_PLACE arrangement; a STEP is TECHNIQUE_IN_ACTION or TOOL_AND_INGREDIENT; an EXPLANATION or FACT is INGREDIENT_MACRO, COMPARISON or a SEQUENCE of states; a check of the result is FINISHED_DISH or INGREDIENT_MACRO; a CTA is FINISHED_DISH, ideally with related dishes behind it.
Variety is required: two slides in a row never have the same shotType, IN_THE_VESSEL is used at most twice in the carousel, and a carousel of four or more pictures uses at least three kinds of shot.

# Arrangement: frames with a meaning
Build each frame from one to six elements and give it an "arrangement":
- HERO: one main subject.
- HERO_WITH_ACCENTS: one main subject and one or two small related accents near it (a whole raw ingredient, a herb sprig, a lemon half).
- HERO_WITH_DEPTH: the hero in front and a related dish or vessel softly out of focus behind it (the pot the rice came from, the other dishes the same method makes).
- SEQUENCE: two or three bowls or spoons of the same size in order, showing the stages.
- TWO_STATES: the same food in two states, as two separate servings.
- LINE_UP: the tools of the step together.
- MISE_EN_PLACE: the portion laid out: the main ingredient and three to six small white porcelain or clear glass bowls with the measured ingredients of the recipe, neatly arranged.
- TOOL_IN_ACTION: one tool doing the step, without a hand: a spoon lifting rice, a spatula tossing grains in a wok, a knife touching a yolk, scissors cutting dough, tweezers holding a thread.
Describe the elements and their order in "prompt". A carousel of five or more pictures uses at least three arrangements, of six or more at least four.

# Placement
On the inner slides (templates B, D, E and F) give each picture a "placement"; the system adds the matching composition and the template puts the picture there, beside the text:
- CORNER: lower right. A single hero, a served bowl, a hero with depth.
- TOP_RIGHT: upper right, for a tool entering from above: a spoon or fork lifting food, grains falling, a pour.
- RIGHT_COLUMN: a tall column on the right: a SEQUENCE or TWO_STATES one above the other, a tall subject.
- BOTTOM_BAND: a wide row along the bottom: a MISE_EN_PLACE, a LINE_UP, a wide pan. Only on a slide with little text: at most about 140 characters besides the headline.
Two inner slides in a row never share a placement. The cover (template A) and template C keep their own composition: leave "placement" out for them.

# Vessels and colour
Default vessels: white porcelain bowls and plates, brushed steel pans and pots, clear glass bowls and jugs. Black cast iron and dark or deep-coloured ceramic make the page heavy: use one only when <recipe> calls for that very vessel, and at most once in the carousel. Name the main vessel of every generated picture in "vessel".
White food on a white page is a blank slide. At least half of the generated pictures carry a clear colour accent; name it in "colorAccent" and say where it comes from in "colorSource":
- RECIPE: an ingredient, a tool or a result of <recipe> or of the slide (golden toasted grains, green peas and diced carrot of the recipe, a yolk, a lemon the recipe uses). Any picture may use it.
- SERVING: a classic serving partner that the recipe does not name (fresh herbs, a lemon wedge, a few cherry tomatoes, a fried egg). Only on the cover and on FINISHED_DISH shots, and never so that it looks like a step of the recipe.
Pale food (rice, quinoa, pasta, oats, dough, cauliflower) gets its contrast from the food around it (a yolk, peas and carrot, herbs, a lemon, toast, a golden crust), a white porcelain rim and a soft shadow, never from a dark pot.

# Visible action and texture
Every picture shows something visible happening or a visible texture: a spoon lifting a portion with separate grains, grains falling, a golden crust, a glossy yolk, droplets on a lid, a glossy sauce. Steam, clear water and a thin starch film barely show on white: never make them the point of a picture.

# The recipe
<recipe> holds the steps, ingredients and usual mistakes of the cards the slides rest on. Take the real tools, actions, amounts and ingredients from there (the strainer of the rinse, the measuring cup of the ratio, the oil of the toasting) even when the slide's short text does not name them. Never show a tool, an ingredient or a step that neither the slide nor <recipe> mentions, and never show the wrong way as the right one. No decorative props: everything in the frame is food, a vessel or a tool of the recipe.

# Rules for each picture
- "source": GENERATE (a new image is generated from "prompt"), LIBRARY (a photo from <library>, give its id as "libraryAssetId") or NONE (only for an optional slot that is better left empty). Required slots (required="true") are never NONE. Prefer a library photo when one really fits the slide and the carousel; otherwise generate. Use a library id only if it is listed in <library>.
- "shotType" (GENERATE): the kind of shot from the shot list.
- "arrangement" (GENERATE): HERO, HERO_WITH_ACCENTS, HERO_WITH_DEPTH, SEQUENCE, TWO_STATES, LINE_UP, MISE_EN_PLACE or TOOL_IN_ACTION.
- "placement" (GENERATE, templates B, D, E and F only): CORNER, TOP_RIGHT, RIGHT_COLUMN or BOTTOM_BAND.
- "vessel" (GENERATE): WHITE_PORCELAIN, STEEL, GLASS, CAST_IRON, DARK_CERAMIC, or NONE when the food stands without one.
- "depicts" (GENERATE): the 2 to 8 words of the slide's text the picture shows, copied exactly.
- "colorAccent" (GENERATE): the colour accent of the picture in a few English words ("diced carrot and green peas", "glossy yolk"), or an empty string when it has none.
- "colorSource" (GENERATE): RECIPE or SERVING for a picture with a colour accent; leave it out when "colorAccent" is empty.
- "prompt" (GENERATE): one to three English sentences of the subject and the action only: every element in the frame and its vessel, what is happening, the camera angle (a 30–45 degree side view by default, top-down only for a MISE_EN_PLACE or a LINE_UP), and the detail that makes it appetizing (separate glistening grains, a golden edge, a glossy yolk). Do not describe the background, the light, the style or where the subject sits in the frame: the system adds them. No text, letters, numbers, logos, watermarks, packaging or brand names. No people, faces or hands.
- "negativePrompt" (GENERATE): only what this picture in particular risks (for example "burnt grains, mushy clumps"), or an empty string; the system adds the fixed list. Empty for LIBRARY and NONE.
- "composition": one short sentence for the reviewer: the shot and why it fits the slide.
- "aspect": the aspect of the slot as given in <slides> ("4:5" for a full slide, "1:1" for a square). For a slot of another aspect use the closest of 4:5, 1:1, 3:4, 16:9.
- Template C ("before" and "after"): each picture has one subject, centred, and the two match in size, angle and light so they read as a pair; the template places them at the two edges of the slide.

# Concept and style
- "concept": two or three sentences: the visual idea of the carousel and how the shots tell the story from state to state.
- "visualStyle": a code from <visual_styles>.
- If <market> lists hypotheses, apply the most suitable one (its description and style) and give its id in "hypothesisId"; otherwise leave "hypothesisId" out.
- Compare with <sibling_briefs>: the hero picture must have a different subject framing and composition from the other markets'. In "differentiationFromSibling" say in a sentence how it differs; with no siblings write an empty string.

# Output
Return only the structured result.`;

const [dataRules, rules] = v6.system;
if (!dataRules || !rules) throw new Error("visual-director@6 has changed shape.");

export default definePrompt({
  id: "visual-director",
  version: 7,
  stage: "VISUAL_DIRECTION",
  input: v6.input,
  output: v6.output,
  ...(v6.outputFor ? { outputFor: v6.outputFor } : {}),
  defaults: v6.defaults,
  system: [{ ...dataRules }, { ...rules, text: DIRECTOR_RULES }],
  render: v6.render,
  ...(v6.renderTemplate ? { renderTemplate: v6.renderTemplate } : {}),
  changelog:
    "Pictures with a meaning: one moment per slide quoted in depicts, the same food in a new state each time, whole subjects, light vessels with a dark one at most once, colour from food, comparisons as two servings, arrangements MISE_EN_PLACE, HERO_WITH_DEPTH and TOOL_IN_ACTION.",
});
