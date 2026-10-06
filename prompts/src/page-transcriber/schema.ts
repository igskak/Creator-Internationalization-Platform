import { z } from "zod";

// Input and output of the page transcriber (plan 07 §7.2.2, M1-24): the model reads pages of an
// attached PDF that have no text layer (scans) and returns their text. The text is then the page
// text that quote checks run against.

export const MAX_PAGES_PER_CALL = 5;

export const TranscriberInput = z
  .object({
    source: z.object({
      title: z.string().min(1),
      /** ISO 639-1 language of the source. */
      language: z.string().min(1),
    }),
    /** Source page numbers of the attached PDF: its first page is `pageStart`, then consecutive. */
    pageStart: z.number().int().positive(),
    pageEnd: z.number().int().positive(),
  })
  .superRefine((value, ctx) => {
    if (value.pageEnd < value.pageStart) {
      ctx.addIssue({ code: "custom", path: ["pageEnd"], message: "pageEnd is before pageStart" });
    } else if (value.pageEnd - value.pageStart + 1 > MAX_PAGES_PER_CALL) {
      ctx.addIssue({
        code: "custom",
        path: ["pageEnd"],
        message: `At most ${MAX_PAGES_PER_CALL} pages per call`,
      });
    }
  });
export type TranscriberInput = z.infer<typeof TranscriberInput>;

export const TranscriberOutput = z.object({
  pages: z.array(
    z.object({
      /** Source page number, as given in the task. */
      page: z.number().int(),
      /** The text of the page; empty when the page has none or cannot be read. */
      text: z.string(),
      /** False when the page is blurred, cut off or otherwise not fully legible. */
      legible: z.boolean(),
    }),
  ),
});
export type TranscriberOutput = z.infer<typeof TranscriberOutput>;
