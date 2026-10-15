import { definePrompt } from "../define";
import v2 from "./v2";

// idea-generator@3 (M7-04, plan 11 §11.5): idea-generator@2 plus the rules for <performance_memory>,
// the summary of what did better and worse at day 7, what was used too often, what is missing,
// what was never tried and which offers matter (the JSON of `PerformanceMemory`, across markets).
// Input, output and rendering are those of v2: the memory was already a section of the message.
// A released version file is never edited: change it in v4.ts.

const MEMORY_RULES = `
# Performance memory
<performance_memory> is a summary of how earlier posts did, measured at day 7, across the markets. Use it to choose between ideas the cards support; it never adds a fact to an idea.
- Prefer the categories, angles and hook-friendly topics of "topPatterns"; avoid building a batch around the values in "weakPatterns". Patterns with confidence "low" are hints, not rules.
- Do not propose an idea whose category (and angle, when one is named) is in "overusedThemes" unless the editor's focus asks for it.
- When "coverageGaps" lists a category and the cards support an idea in it, include at least one such idea.
- When "untestedHypotheses" is not empty, at least one idea of the batch should give one of them a fair chance (a topic that suits the visual idea, a hook type that was never used); say which one in "whyNow".
- Respect "offerPriorities" as in the offer rule above: a higher priority gets the chance when two ideas fit equally, never a forced product.
- "caveats" says how far the numbers can be trusted; with few posts, lean on overuse, gaps and offers rather than on patterns.
- In "whyNow", name the part of the memory the idea answers (a strong pattern, a gap, an untested idea, an offer). Never quote numbers that are not in the memory, and never claim a pattern the memory does not list.
- When <performance_memory> is absent, ignore this section.`;

const [dataRules, rules] = v2.system;
if (!dataRules || !rules) throw new Error("idea-generator@2 has changed shape.");
const OUTPUT_HEADING = "\n\n# Output\n";
if (!rules.text.includes(OUTPUT_HEADING)) throw new Error("idea-generator@2 has changed shape.");
const IDEA_RULES = rules.text.replace(OUTPUT_HEADING, `\n${MEMORY_RULES}${OUTPUT_HEADING}`);

export default definePrompt({
  id: "idea-generator",
  version: 3,
  stage: "IDEA_GENERATION",
  input: v2.input,
  output: v2.output,
  ...(v2.outputFor ? { outputFor: v2.outputFor } : {}),
  defaults: v2.defaults,
  system: [
    { text: dataRules.text, cache: false },
    { text: IDEA_RULES, cache: true },
  ],
  render: v2.render,
  ...(v2.renderTemplate ? { renderTemplate: v2.renderTemplate } : {}),
  changelog:
    "Rules for <performance_memory>: prefer strong patterns, avoid overused themes, fill a coverage gap, give an untested idea a chance, respect offer priorities, and name the reason in whyNow.",
});
