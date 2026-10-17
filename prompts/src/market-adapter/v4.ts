import { definePrompt } from "../define";
import v3 from "./v3";

// market-adapter@4 (CV-04, docs/design/carousel-v3-requirements.md T1): market-adapter@3 plus the
// arc of the reference account. The live English plans had 6–7 slides around two fixes and a
// summary; the reference carousels teach a method in 8: the hook, how people usually do it, the
// principle, the portion with its amounts, two or three steps with their numbers, how to tell it
// worked, and the closing call. The planner maps that arc onto the existing roles (PROBLEM or
// MISTAKE, EXPLANATION, FACT, STEP, SUMMARY). Input and output are those of v3. A released version
// file is never edited: change it in v5.ts.

const OLD_STRUCTURE =
  "- Structure: choose roles and templates that serve this market's story. If <sibling_plans> is not empty, the order of roles and templates must differ visibly from every sibling plan, not only in the wording of the purposes. Keep the same facts; change the route to them.";

const NEW_STRUCTURE = `- Story: plan the carousel as a short lesson the reader can cook from, usually 7 or 8 slides: HOOK (a doubt about a familiar habit or a surprising claim) → the usual way (PROBLEM or MISTAKE: what people usually do and what goes wrong) → the principle (EXPLANATION: the one mechanism behind it) → the portion (FACT: the ingredients and amounts for a named number of servings; only when the cards give amounts) → one to three STEP slides (one action each, with its amount, time or heat and a cue the reader can see) → the check (SUMMARY: how to tell it worked, three to five signs) → CTA. An idea without a recipe (a myth, a principle) drops the portion and gives an example or a consequence instead. Each slide must have enough of the cards behind it for a full slide of text: merge two thin slides rather than pad, and plan fewer than 6 slides only when the cards really hold less.
- Structure: choose roles and templates that serve this market's story within that arc. If <sibling_plans> is not empty, the order of roles and templates must differ visibly from every sibling plan, not only in the wording of the purposes. Keep the same facts; change the route to them.`;

// Owner decision 2026-10-17 (D4): until a lead magnet exists, the call to action is "send it on and
// follow", not a save and not a keyword.
const OLD_CTA = "Without an offer use SAVE, SHARE, FOLLOW or NONE.";
const NEW_CTA =
  "Without an offer use SHARE: the call to action asks the reader to send the post to someone who cooks and to follow the account (the follow ask goes into the writer's text; the code stays SHARE). Use NONE only when the plan has no CTA slide.";

const [dataRules, rules] = v3.system;
if (!dataRules || !rules) throw new Error("market-adapter@3 has changed shape.");
if (!rules.text.includes(OLD_STRUCTURE) || !rules.text.includes(OLD_CTA)) {
  throw new Error("market-adapter@3 has changed shape.");
}

export default definePrompt({
  id: "market-adapter",
  version: 4,
  stage: "MARKET_ADAPTATION",
  input: v3.input,
  output: v3.output,
  ...(v3.outputFor ? { outputFor: v3.outputFor } : {}),
  defaults: v3.defaults,
  system: [
    { text: dataRules.text, cache: false },
    {
      text: rules.text.replace(OLD_STRUCTURE, NEW_STRUCTURE).replace(OLD_CTA, NEW_CTA),
      cache: true,
    },
  ],
  render: v3.render,
  ...(v3.renderTemplate ? { renderTemplate: v3.renderTemplate } : {}),
  changelog:
    "The arc of a lesson the reader can cook from, usually 7 or 8 slides: hook, the usual way, the principle, the portion, steps with numbers, the check, the call; merge thin slides instead of padding.",
});
