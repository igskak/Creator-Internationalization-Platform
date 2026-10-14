import { definePrompt } from "../define";
import { hookPatternsLine } from "../shared/hook-library";
import v2 from "./v2";

// market-adapter@3 (M2-12b): market-adapter@2 whose <hook_types> terms carry the patterns and the
// best angles of each hook type (docs/design/hook-library.md), so the plan's hook type is chosen by
// what the idea's angle and cards can support, not by the label alone. Input and output are those
// of v2. A released version file is never edited: change it in v4.ts.

const HOOK_TYPE_RULE =
  '- "hookType": choose one code from <taxonomy> that suits this market\'s audience and the idea. Each hook type lists the patterns it covers and the angles it fits: prefer a type whose pattern the cards can back and whose angles include the idea\'s angle. NUMBER_OR_STAT only when the plan has 3 to 5 distinct points to count; BOLD_CLAIM only when a card states the claim outright; BEFORE_AFTER only when the cards give two outcomes of the same thing. If <sibling_plans> is not empty, choose a different hook type from every sibling plan unless no other type fits, and then say why in "differentiationNotes".';

const [dataRules, rules] = v2.system;
if (!dataRules || !rules) throw new Error("market-adapter@2 has changed shape.");

const OLD_HOOK_RULE = /^- "hookType": choose one code from <taxonomy>[^\n]*$/mu;
const ADAPTER_RULES = rules.text.replace(OLD_HOOK_RULE, HOOK_TYPE_RULE);
if (ADAPTER_RULES === rules.text) throw new Error("market-adapter@2 has changed shape.");

const OLD_TEMPLATE = "<taxonomy><hook_types><term code>…";
const TEMPLATE = v2.renderTemplate;
if (!TEMPLATE || !TEMPLATE.includes(OLD_TEMPLATE)) {
  throw new Error("market-adapter@2 has changed shape.");
}

export default definePrompt({
  id: "market-adapter",
  version: 3,
  stage: "MARKET_ADAPTATION",
  input: v2.input,
  output: v2.output,
  ...(v2.outputFor ? { outputFor: v2.outputFor } : {}),
  defaults: v2.defaults,
  system: [
    { text: dataRules.text, cache: false },
    { text: ADAPTER_RULES, cache: true },
  ],
  render: (input) =>
    v2.render({
      ...input,
      taxonomy: {
        ...input.taxonomy,
        hookTypes: input.taxonomy.hookTypes.map((t) => ({
          ...t,
          description: t.description ?? hookPatternsLine(t.code),
        })),
      },
    }),
  renderTemplate: TEMPLATE.replace(
    OLD_TEMPLATE,
    "<taxonomy><hook_types><term code>(label — patterns, angles)…",
  ),
  changelog:
    "Hook type terms carry their patterns and best angles from the hook library; the hookType rule says to pick a type the cards can back.",
});
