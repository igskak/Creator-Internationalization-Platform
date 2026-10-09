import { definePrompt } from "../define";
import v1 from "./v1";

// content-writer@2 (M2-12a): content-writer@1 plus a rule for the hook line. The G1 pilot's weak
// English hook was a general statement; the writer is told what a hook must do. Input, output and
// rendering are those of v1. A released version file is never edited: change it in v3.ts.

const HOOK_RULE =
  "- The hook must stop the scroll: give the reader a concrete reason to read on (a surprising fact, a named mistake, a busted myth, a question they care about, a specific number or result), taken from the cards. A general statement, a title or a line that would fit any recipe is not a hook.";

const [dataRules, rules] = v1.system;
if (!dataRules || !rules) throw new Error("content-writer@1 has changed shape.");

const WRITER_RULES = rules.text.replace(
  '- "altText" describes',
  `${HOOK_RULE}\n- "altText" describes`,
);
if (WRITER_RULES === rules.text) throw new Error("content-writer@1 has changed shape.");

export default definePrompt({
  id: "content-writer",
  version: 2,
  stage: "CONTENT_WRITING",
  input: v1.input,
  output: v1.output,
  ...(v1.outputFor ? { outputFor: v1.outputFor } : {}),
  defaults: v1.defaults,
  system: [
    { text: dataRules.text, cache: false },
    { text: WRITER_RULES, cache: true },
  ],
  render: v1.render,
  ...(v1.renderTemplate ? { renderTemplate: v1.renderTemplate } : {}),
  changelog: "Adds the rule that the hook line must give a concrete reason to read on.",
});
