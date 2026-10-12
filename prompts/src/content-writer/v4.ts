import { definePrompt } from "../define";
import v3 from "./v3";

// content-writer@4: content-writer@3 plus emphasis. The carousel style (docs/design/carousel-style.md)
// makes hierarchy by weight: a few key phrases of the body in bold, one headline word in the accent
// colour. The writer marks them with `**…**` in slot text; the templates draw the markers and the
// slot limits do not count them. Input, output and rendering are those of v3. A released version
// file is never edited: change it in v5.ts.

const EMPHASIS_RULE =
  '- Emphasis, inside slot text only: wrap the one to three words that carry the point of a headline or title slot in double asterisks ("Rinse it **first.**"), and up to three key phrases of a body or text slot ("Toast it **before the liquid goes in.**"). The markers do not count towards "max_chars". Never mark a whole slot, never leave a marker open, and use no other formatting. Never put asterisks in "hook", "caption", "altText" or "cta".';

const [dataRules, rules] = v3.system;
if (!dataRules || !rules) throw new Error("content-writer@3 has changed shape.");

const WRITER_RULES = rules.text.replace(
  "- Slide text is short and plain: no links or web addresses, no emoji, no hashtags. One idea per slide.",
  `- Slide text is short and plain: no links or web addresses, no emoji, no hashtags. One idea per slide.\n${EMPHASIS_RULE}`,
);
if (WRITER_RULES === rules.text) throw new Error("content-writer@3 has changed shape.");

export default definePrompt({
  id: "content-writer",
  version: 4,
  stage: "CONTENT_WRITING",
  input: v3.input,
  output: v3.output,
  ...(v3.outputFor ? { outputFor: v3.outputFor } : {}),
  defaults: v3.defaults,
  system: [
    { text: dataRules.text, cache: false },
    { text: WRITER_RULES, cache: true },
  ],
  render: v3.render,
  ...(v3.renderTemplate ? { renderTemplate: v3.renderTemplate } : {}),
  changelog:
    "Marks key phrases of slot text with **…** for the bold and accent emphasis of the templates.",
});
