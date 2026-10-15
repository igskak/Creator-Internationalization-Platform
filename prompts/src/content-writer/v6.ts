import { z } from "zod";
import { definePrompt } from "../define";
import { renderSections, section } from "../xml";
import { ContentWriterInput } from "./schema";
import v5 from "./v5";

// content-writer@6 (M7-04, plan 11 §11.5): content-writer@5 plus <learning>, what the market's
// performance memory says to the writer: hook-type guidance from the day-7 numbers (advice, the
// plan's hook type stays) and an "avoid" list from the reasons reviewers rejected drafts for. The
// best posts at day 7 come in as ordinary examples (kind EXEMPLAR). Output is that of v5. A
// released version file is never edited: change it in v7.ts.

export const WriterLearning = z.object({
  /** e.g. "QUESTION hooks: 1.7× the market's save rate (7 posts)". */
  hookGuidance: z.array(z.string().min(1)).max(6).default([]),
  /** e.g. "Weak hook (rejected 4 times)". */
  avoid: z.array(z.string().min(1)).max(6).default([]),
});
export type WriterLearning = z.infer<typeof WriterLearning>;

export const ContentWriterInputV6 = ContentWriterInput.extend({
  learning: WriterLearning.optional(),
});
export type ContentWriterInputV6 = z.infer<typeof ContentWriterInputV6>;

const LEARNING_RULE =
  "- <learning>, when present, is what this market's numbers and reviewers say. Its hook guidance is advice: the plan's hook type stays, use the guidance to choose the strongest line within it. Treat its \"avoid\" list as problems reviewers rejected drafts for and do not repeat them. Never put a number from <learning> into the copy.";

const [dataRules, rules] = v5.system;
if (!dataRules || !rules) throw new Error("content-writer@5 has changed shape.");
const DATA_TAGS = "<taxonomy>, <task>)";
if (!dataRules.text.includes(DATA_TAGS)) throw new Error("content-writer@5 has changed shape.");
const DATA_RULES = dataRules.text.replace(DATA_TAGS, "<taxonomy>, <learning>, <task>)");
const ANCHOR = '- "altText" describes';
if (!rules.text.includes(ANCHOR)) throw new Error("content-writer@5 has changed shape.");
const WRITER_RULES = rules.text.replace(ANCHOR, `${LEARNING_RULE}\n${ANCHOR}`);

const learningSection = (learning: WriterLearning) =>
  section("learning", [
    section(
      "hook_guidance",
      learning.hookGuidance.map((line) => section("note", line)),
    ),
    section(
      "avoid",
      learning.avoid.map((line) => section("item", line)),
    ),
  ]);

export default definePrompt({
  id: "content-writer",
  version: 6,
  stage: "CONTENT_WRITING",
  input: ContentWriterInputV6,
  output: v5.output,
  ...(v5.outputFor
    ? {
        outputFor: (input: ContentWriterInputV6) =>
          (v5.outputFor as NonNullable<typeof v5.outputFor>)(input),
      }
    : {}),
  defaults: v5.defaults,
  system: [
    { text: DATA_RULES, cache: false },
    { text: WRITER_RULES, cache: true },
  ],
  render: (input) => {
    const { learning, ...rest } = input;
    const parts = v5.render(rest);
    const empty = !learning || (learning.hookGuidance.length === 0 && learning.avoid.length === 0);
    if (empty) return parts;
    // <learning> goes right before <task>, the last section of the message.
    return parts.map((part, i) => {
      if (i !== parts.length - 1) return part;
      const at = part.text.lastIndexOf("<task");
      if (at < 0)
        return { ...part, text: `${part.text}\n\n${renderSections(learningSection(learning))}` };
      return {
        ...part,
        text: `${part.text.slice(0, at)}${renderSections(learningSection(learning))}\n\n${part.text.slice(at)}`,
      };
    });
  },
  renderTemplate: (v5.renderTemplate ?? "").replace(
    " <task>",
    " [<learning><hook_guidance><note>…<avoid><item>…>] <task>",
  ),
  changelog:
    "<learning>: hook-type guidance from the market's day-7 numbers (advice; the plan's hook type stays) and an avoid list from rejection reasons; the best posts at day 7 come in as examples.",
});
