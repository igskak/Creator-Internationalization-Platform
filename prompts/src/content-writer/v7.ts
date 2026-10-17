import { definePrompt } from "../define";
import { MAX_CAPTION_CHARS } from "./schema";
import v5 from "./v5";

// content-writer@7 (CV-04, docs/design/carousel-v3-requirements.md T2–T8, C1): content-writer@5
// plus the text of carousel v3. The live English carousels carried 100–220 characters of general
// lines per slide ("breathe, there's a calm fix") and no numbers; the reference account teaches a
// method a reader can cook from: one sentence per line, amounts, times and visible cues on every
// step, a quieter lead and a bold closing line, a caption that repeats the whole method. The
// templates (3.0.0) give the body room for it. Built on v5, not v6: the learning of v6 waits for
// D7 numbers (decision log 2026-10-15), so this version does not switch it on. Input, output and
// rendering are those of v5. A released version file is never edited: change it in v8.ts.

const OLD_FORM =
  "- Slide text is short and plain: no links or web addresses, no emoji, no hashtags. One idea per slide.";

const NEW_FORM = `- Slide text is plain: no links or web addresses, no emoji, no hashtags. One idea per slide, told in full: a reader should be able to cook from the slides alone.
- Write body and text slots as a ladder: one short sentence or fact per line (start a new line with "\\n"), and a blank line ("\\n\\n") between groups of lines. Lines of 3 to 9 words read best. On inner slides fill most of the slot, about 55 to 95 % of its max_chars: a body of one or two lines is a wasted slide.
- Be concrete. Every STEP slide and every slide that lists ingredients carries the numbers of the cards (amounts, times, temperatures, ratios) and a cue the reader can see or hear ("until the water runs clearer", "when the surface starts to bubble"). Say what to do, in what order, and why it works, in the cards' terms.
- No filler: never write a line that carries no information, such as "breathe", "don't panic", "no rush", "a calm fix", "it happens to everyone", "here's the thing", "the secret is simple", "trust the process", "game changer", or their equivalents in the market's language.
- A sub-head inside a body is a short line in bold ending with a colon ("**For 2 servings:**", "**Important:**").
- Optional slots, where the template has them: "lead" is the quieter first half of a headline, in regular weight (the setup: "The perfect fried egg is better cooked"), and the headline is the punch ("not all at once."); use a lead on two or three slides of a carousel, not on all. "closer" is a bold last line under the body: a consequence, a rule to remember, or a question the next slide answers ("So how do you get both at once?"); use one on about half of the inner slides, never the same words twice.`;

const OLD_EMPHASIS =
  '- Emphasis, inside slot text only: wrap the one to three words that carry the point of a headline or title slot in double asterisks ("Rinse it **first.**"), and up to three key phrases of a body or text slot ("Toast it **before the liquid goes in.**").';

const NEW_EMPHASIS =
  '- Emphasis, inside slot text only: on at most half of the slides wrap the one to three words that carry the point of a headline or title slot in double asterisks ("Rinse it **first.**"; they turn red, so keep them for a turn or a number), and mark up to three key phrases of a body or text slot ("Toast it **before the liquid goes in.**"; they turn bold).';

const HOOK_DELIVERS_RULE =
  '- The HOOK slide pairs the hook with one to three short lines in its subline that say what the carousel delivers: the steps or conditions it covers ("Rinse. Water. Heat. Rest."), or what changes for the reader, from the cards.\n- If <brand_voice> gives a sign-off line, the CTA slide\'s headline is that line, word for word; otherwise the CTA headline sums up the principle of the carousel in a few words.';

const OLD_CAPTION = `- "caption": the hook line first, then the value of the post in a few sentences, then the call to action. At most ${MAX_CAPTION_CHARS} characters. No hashtags in the caption, no links, no more than a few emoji.`;

const NEW_CAPTION = `- "caption": the hook line first; then the problem in one or two sentences; then the method in short paragraphs with the same numbers as the slides (amounts, times, temperatures), one step per paragraph, numbered "1.", "2." when there are steps; then, when the cards state a limit (a variety, a size or a case the method does not cover), a line that starts with "Important:" in the market's language; then one personal line in the brand voice that adds no new fact; then the call to action. 900 to ${MAX_CAPTION_CHARS} characters. No hashtags in the caption, no links, at most three emoji.`;

// Owner decision 2026-10-17 (D4): until a lead magnet exists the ask is "send it on and follow".
const CTA_ASK_RULE =
  '- When the plan\'s CTA type is SHARE, the CTA slide, the "cta" text and the end of the caption ask for both things in the market\'s language and in the brand voice: send this to someone who cooks (name who it helps, from the post), and follow the account for the next one. One short sentence each, no bait ("comment YES", "tag three friends"), no promise of a guide or a reward.';

const [dataRules, rules] = v5.system;
if (!dataRules || !rules) throw new Error("content-writer@5 has changed shape.");

let WRITER_RULES = rules.text;
for (const [from, to] of [
  [OLD_FORM, NEW_FORM],
  [OLD_EMPHASIS, NEW_EMPHASIS],
  [OLD_CAPTION, NEW_CAPTION],
] as const) {
  if (!WRITER_RULES.includes(from)) throw new Error("content-writer@5 has changed shape.");
  WRITER_RULES = WRITER_RULES.replace(from, to);
}
const HOOK_ANCHOR = '- "altText" describes';
if (!WRITER_RULES.includes(HOOK_ANCHOR)) throw new Error("content-writer@5 has changed shape.");
WRITER_RULES = WRITER_RULES.replace(
  HOOK_ANCHOR,
  `${HOOK_DELIVERS_RULE}\n${CTA_ASK_RULE}\n${HOOK_ANCHOR}`,
);

export default definePrompt({
  id: "content-writer",
  version: 7,
  stage: "CONTENT_WRITING",
  input: v5.input,
  output: v5.output,
  ...(v5.outputFor ? { outputFor: v5.outputFor } : {}),
  defaults: v5.defaults,
  system: [
    { text: dataRules.text, cache: false },
    { text: WRITER_RULES, cache: true },
  ],
  render: v5.render,
  ...(v5.renderTemplate ? { renderTemplate: v5.renderTemplate } : {}),
  changelog:
    "Carousel v3 text: ladder bodies that fill the slot, the cards' numbers and a visible cue on every step, no filler, lead and closer slots, red emphasis on at most half of the slides, a hook slide that says what the carousel delivers, the sign-off line on the CTA, and a caption that carries the whole method.",
});
