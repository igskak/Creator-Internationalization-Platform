import { z } from "zod";

// Input and output of the visual director (plan 07 §7.6.1, §7.6.4, M3-02). The output has the
// shape of `VisualBrief` in `@rc/db/json`; the validators of `modules/src/content/visual` check
// it against the slides and the template slots.

export const VISUAL_SOURCES = ["GENERATE", "LIBRARY", "NONE"] as const;
export const VISUAL_ASPECTS = ["4:5", "1:1", "3:4", "16:9"] as const;

/**
 * Kinds of shot of the carousel's shot list (visual-director@4, docs/design/carousel-style.md):
 * the director plans the sequence first, so the slides do not all show the same pot.
 */
export const SHOT_TYPES = [
  /** The ingredient itself, close, without a vessel: a heap, scattered grains, a spoonful. */
  "INGREDIENT_MACRO",
  /** The technique while it happens: water through a strainer, grains falling, steam, oil. */
  "TECHNIQUE_IN_ACTION",
  /** Two states side by side in one frame (raw | toasted, before | after). */
  "COMPARISON",
  /** The tool of the step with the ingredient: a measuring cup, a strainer, a spoon. */
  "TOOL_AND_INGREDIENT",
  /** The finished food, served or packed. */
  "FINISHED_DISH",
  /** The food in its pot or pan. */
  "IN_THE_VESSEL",
] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

/**
 * Where an inner slide's picture sits (visual-director@6). The template moves the cut-out layer to
 * the same place and narrows the text column for the right-hand ones.
 */
export const PLACEMENTS = [
  /** Lower right, cropped by the right and bottom edges (the default). */
  "CORNER",
  /** Entering from the top-right corner, cropped by the top and right edges. */
  "TOP_RIGHT",
  /** A tall column down the right side, top to bottom. */
  "RIGHT_COLUMN",
  /** A wide band across the bottom; only for slides with little text. */
  "BOTTOM_BAND",
] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** How the frame is built (visual-director@6). */
export const ARRANGEMENTS = [
  /** One main subject. */
  "HERO",
  /** One main subject and one or two small related accents near it. */
  "HERO_WITH_ACCENTS",
  /** Two or three of the same item in order: the stages of the process. */
  "SEQUENCE",
  /** Two states of the same food, side by side or one above the other. */
  "TWO_STATES",
  /** The ingredients or tools of the step laid out together. */
  "LINE_UP",
] as const;

/** Where a picture's colour accent comes from (visual-director@5). */
export const COLOR_SOURCES = [
  /** An ingredient, tool or result of the recipe or the slide. */
  "RECIPE",
  /** A serving partner the recipe does not name: only on the cover and the finished dish. */
  "SERVING",
] as const;

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
  /**
   * The recipe behind the slides, from the idea's approved cards: the steps (with the tools they
   * name), the ingredients and the usual mistakes. Rendered from visual-director@4 on.
   */
  recipe: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        claim: z.string(),
        steps: z.array(z.string()).default([]),
        ingredients: z.array(z.string()).default([]),
        mistakes: z.array(z.string()).default([]),
      }),
    )
    .default([]),
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
      /** The kind of shot of the shot list (visual-director@4 on). */
      shotType: z.enum(SHOT_TYPES).optional(),
      /** The colour accent in a few words, "" when none (visual-director@5 on). */
      colorAccent: z.string().optional(),
      colorSource: z.enum(COLOR_SOURCES).optional(),
      /** Where the picture sits on an inner slide, and how the frame is built (visual-director@6 on). */
      placement: z.enum(PLACEMENTS).optional(),
      arrangement: z.enum(ARRANGEMENTS).optional(),
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
