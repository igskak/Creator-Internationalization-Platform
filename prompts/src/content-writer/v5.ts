import { definePrompt } from "../define";
import { hookGuidance } from "../shared/hook-library";
import v4 from "./v4";

// content-writer@5 (M2-12b): content-writer@4 plus the hook library (docs/design/hook-library.md).
// The plan's hook type is listed in <taxonomy> with its patterns and example cover lines in the
// market's language, and two rules tell the writer to follow one pattern and what a hook must not
// promise. The same banned patterns are checked in code (`validateHookLine`). Input and output are
// those of v4. A released version file is never edited: change it in v6.ts.

const HOOK_PATTERN_RULE =
  "- The hook follows one pattern of the plan's hook type; <taxonomy> lists that type's patterns and example lines. Write a new line for this post and this market, never a copy of an example or a translation of one. The claim behind the hook comes from the cards, and the next slide answers it.";

const HOOK_LIMITS_RULE =
  '- In the "hook" and on the HOOK slide never use: an invented personal experience ("I tested…", "I spent five years…"), a guarantee or an invented statistic ("works 100% of the time", "guaranteed", "10x better"), conspiracy framing ("nobody tells you", "experts hide this"), a time promise the cards do not make ("in a minute", "by tomorrow"), or empty hype with no claim behind it ("this will change everything"). A number in the hook is a number from the cards or the count of the points in the carousel.';

const [dataRules, rules] = v4.system;
if (!dataRules || !rules) throw new Error("content-writer@4 has changed shape.");

const WRITER_RULES = rules.text.replace(
  '- "altText" describes',
  `${HOOK_PATTERN_RULE}\n${HOOK_LIMITS_RULE}\n- "altText" describes`,
);
if (WRITER_RULES === rules.text) throw new Error("content-writer@4 has changed shape.");

const OLD_TEMPLATE = "<taxonomy><hook_types><term code>…";
const TEMPLATE = v4.renderTemplate;
if (!TEMPLATE || !TEMPLATE.includes(OLD_TEMPLATE)) {
  throw new Error("content-writer@4 has changed shape.");
}

export default definePrompt({
  id: "content-writer",
  version: 5,
  stage: "CONTENT_WRITING",
  input: v4.input,
  output: v4.output,
  ...(v4.outputFor ? { outputFor: v4.outputFor } : {}),
  defaults: v4.defaults,
  system: [
    { text: dataRules.text, cache: false },
    { text: WRITER_RULES, cache: true },
  ],
  render: (input) => {
    const planned = input.brief.hookType;
    return v4.render({
      ...input,
      taxonomy: {
        ...input.taxonomy,
        hookTypes: input.taxonomy.hookTypes.map((t) => {
          const guidance =
            t.code === planned ? hookGuidance(t.code, input.market.language) : undefined;
          return guidance ? { ...t, label: `${t.label} — ${guidance}` } : t;
        }),
      },
    });
  },
  renderTemplate: TEMPLATE.replace(
    OLD_TEMPLATE,
    "<taxonomy><hook_types><term code>(label; for the plan's hook type also patterns and example lines)…",
  ),
  changelog:
    "The plan's hook type comes with its patterns and example lines from the hook library; rules: follow one pattern, never copy an example, and no invented experience, guarantee, conspiracy framing, time promise or empty hype in the hook.",
});
