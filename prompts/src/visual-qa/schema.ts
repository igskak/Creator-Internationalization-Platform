import { z } from "zod";

// Input and output of the visual QA (plan 07 §7.6.1, M3-17): a vision model looks at the rendered
// slide JPEGs (attached before the text, in slide order) and reports what the deterministic render
// checks cannot see.

export const VISUAL_QA_CATEGORIES = [
  "LEGIBILITY",
  "AI_ARTIFACT",
  "TEXT_IN_IMAGE",
  "BRAND",
  "COMPOSITION",
  "OTHER",
] as const;
export const VISUAL_QA_SEVERITIES = ["MAJOR", "MINOR"] as const;

export const VisualQaInput = z.object({
  market: z.object({ code: z.string().min(1), displayName: z.string() }),
  brandVoice: z.string(),
  /** The slides attached as images, in the order of the images. */
  slides: z
    .array(
      z.object({
        slideId: z.string().min(1),
        index: z.number().int().nonnegative(),
        role: z.string().min(1),
        templateId: z.string().min(1),
        /** What the slide's text says, so the model can tell its own words from a picture's. */
        texts: z.array(z.object({ slot: z.string().min(1), text: z.string() })),
      }),
    )
    .min(1)
    .max(10),
});
export type VisualQaInput = z.infer<typeof VisualQaInput>;

export const VisualQaOutput = z.object({
  issues: z.array(
    z.object({
      /** The `id` of the slide the issue is on, as given in the task. */
      slideId: z.string().min(1),
      severity: z.enum(VISUAL_QA_SEVERITIES),
      category: z.enum(VISUAL_QA_CATEGORIES),
      explanation: z.string(),
      suggestedFix: z.string(),
    }),
  ),
});
export type VisualQaOutput = z.infer<typeof VisualQaOutput>;
