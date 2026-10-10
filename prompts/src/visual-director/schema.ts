import { z } from "zod";

// Input and output of the visual director (plan 07 §7.6.1, §7.6.4, M3-02). The output has the
// shape of `VisualBrief` in `@rc/db/json`; the validators of `modules/src/content/visual` check
// it against the slides and the template slots.

export const VISUAL_SOURCES = ["GENERATE", "LIBRARY", "NONE"] as const;
export const VISUAL_ASPECTS = ["4:5", "1:1", "3:4", "16:9"] as const;

const ImageSlot = z.object({
  name: z.string().min(1),
  /** The aspect of the template slot; the plan's "8:5" is half of the canvas. */
  aspect: z.string().min(1),
  required: z.boolean(),
});

export const VisualDirectorInput = z.object({
  idea: z.object({ topic: z.string(), coreMessage: z.string() }),
  market: z.object({
    code: z.string().min(1),
    displayName: z.string(),
    /** The market's visual hypotheses worth applying; empty when it has none. */
    hypotheses: z
      .array(
        z.object({
          id: z.string().min(1),
          description: z.string(),
          visualStyle: z.string().min(1),
          status: z.string(),
        }),
      )
      .default([]),
  }),
  /** The slides of the finished draft, in order. */
  slides: z
    .array(
      z.object({
        slideId: z.string().min(1),
        index: z.number().int().nonnegative(),
        role: z.string().min(1),
        templateId: z.string().min(1),
        slots: z.array(z.object({ name: z.string().min(1), text: z.string() })),
        imageSlots: z.array(ImageSlot),
      }),
    )
    .min(1),
  /** Library photos the director may choose; their rights already allow a visual transform. */
  libraryCandidates: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string(),
        tags: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  /** The other markets' briefs: the hero composition to be different from. */
  siblingBriefs: z
    .array(
      z.object({
        marketCode: z.string().min(1),
        concept: z.string(),
        visualStyle: z.string(),
        compositions: z.array(z.string()),
      }),
    )
    .default([]),
  /** Taxonomy `visual_style` codes. */
  visualStyles: z.array(z.object({ code: z.string().min(1), label: z.string() })).min(1),
});
export type VisualDirectorInput = z.infer<typeof VisualDirectorInput>;

/** `VisualBrief` of `@rc/db/json`. */
export const VisualDirectorOutput = z.object({
  concept: z.string(),
  visualStyle: z.string().min(1),
  /** The id of the market hypothesis applied; omitted when none was. */
  hypothesisId: z.string().min(1).optional(),
  slides: z.array(
    z.object({
      slideId: z.string().min(1),
      slot: z.string().min(1),
      source: z.enum(VISUAL_SOURCES),
      libraryAssetId: z.string().min(1).optional(),
      prompt: z.string().optional(),
      negativePrompt: z.string().optional(),
      composition: z.string(),
      aspect: z.enum(VISUAL_ASPECTS),
    }),
  ),
  differentiationFromSibling: z.string(),
});
export type VisualDirectorOutput = z.infer<typeof VisualDirectorOutput>;

export function visualDirectorOutputFor(
  _input: VisualDirectorInput,
): z.ZodType<VisualDirectorOutput> {
  return VisualDirectorOutput;
}
