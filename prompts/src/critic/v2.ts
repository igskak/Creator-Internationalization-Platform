import { definePrompt } from "../define";
import { CriticInput, CriticOutputV2, criticOutputV2For } from "./schema";
import v1 from "./v1";

// critic@2 (plan 07 §7.6.1, M2-12a): critic@1 plus a hook-strength check. The G1 pilot let a
// general statement pass as an English hook (4.37); the critic now scores the hook on its own
// and says how to fix a weak one. Input and rendering are those of v1. A released version file is
// never edited: change it in v3.ts.

const HOOK_RULES = `- **Hook.** The hook (path "hook", and the HOOK slide that repeats it) is the line that must stop the scroll. Score it on its own as "hook". A real hook gives the reader a concrete reason to read on: a surprising fact, a named mistake, a myth that is busted, a question the reader cares about, a specific number or result. A general statement ("Cooking is an art", "Here are some tips for better pasta"), a title, a summary of the post or a hook that would fit any recipe is weak. Judge it by the draft and the cards only, in the market's language; it must still be supported by the cards.`;

const HOOK_SCORES = `
For "hook": 5 stops the scroll with something specific, 4 is clear and interesting, 3 is acceptable but generic, 2 is a general statement or a title (a weak hook), 1 says nothing. A hook scored 2 or less needs an issue of the category HOOK with the exact field path "hook" and a "suggestedFix" that is a concrete new hook line in the market's language, built only from what the cards support.`;

const [dataRules, rules] = v1.system;
if (!dataRules || !rules) throw new Error("critic@1 has changed shape.");

const CRITIC_RULES = rules.text
  .replace("- **Source coverage.**", `${HOOK_RULES}\n- **Source coverage.**`)
  .replace("# Verdict", `${HOOK_SCORES.trim()}\n\n# Verdict`)
  .replace("a category, the exact", 'a category (use "HOOK" for the hook), the exact');

export default definePrompt({
  id: "critic",
  version: 2,
  stage: "CRITIC",
  input: CriticInput,
  output: CriticOutputV2,
  outputFor: criticOutputV2For,
  defaults: v1.defaults,
  system: [
    { text: dataRules.text, cache: false },
    { text: CRITIC_RULES, cache: true },
  ],
  render: v1.render,
  ...(v1.renderTemplate ? { renderTemplate: v1.renderTemplate } : {}),
  changelog:
    "Adds the hook score and the HOOK issue category: a weak hook (a general statement) is scored 2 or less and comes with a concrete replacement.",
});
