import type { Slide, VisualBrief } from "@rc/db/json";
import type { TemplateRegistry } from "@rc/templates";

// The photo prompt of a generated picture (docs/design/carousel-style.md). From visual-director@4
// on the director writes only the subject and the action and names the kind of shot; the code adds
// the composition of the template slot, the style sentence and the fixed negative list, so every
// picture of a carousel shares them word for word and the style does not drift with the model.

/** Where the subject sits for each kind of slot; the templates leave the rest of the frame empty. */
export const SLOT_COMPOSITION = {
  /** Template A's full-bleed cover: the headline sits on the bottom third, over a dark shade. */
  cover:
    "Composition: the subject fills the upper two thirds of the frame and may be cropped by the side; the bottom third of the frame is calm and simple.",
  /** Templates B, D, E and F: the picture bleeds off the right and bottom edges beside the text. */
  side: "Composition: the subject sits in the right 60% and lower part of the frame and is cropped by the right edge and the bottom edge. The left 40% of the frame, top to bottom, is completely empty pure white.",
  /** Template C: each picture is cut at one edge of the slide, so its subject is centred. */
  centred:
    "Composition: one subject, centred, with pure white all around it and a clear margin on every side.",
} as const;

/** A COMPARISON shot: the same slot, but one frame split into two equal halves. */
export const SPLIT_COMPOSITION = {
  cover:
    "Composition: one frame split down the middle into two equal halves that show the two states side by side with the same angle and light; together they fill the upper two thirds of the frame, and the bottom third is calm and simple.",
  side: "Composition: one frame split down the middle into two equal halves that show the two states side by side with the same angle and light; together they sit in the right 60% and lower part of the frame and are cropped by the right edge and the bottom edge. The left 40% of the frame, top to bottom, is completely empty pure white.",
  centred:
    "Composition: one frame split down the middle into two equal halves that show the two states side by side with the same angle and light, centred, with pure white all around.",
} as const;

/**
 * Where an inner slide's picture sits (visual-director@6); the template moves the cut-out to the
 * same place. CORNER is the side composition above.
 */
export const PLACEMENT_COMPOSITION = {
  CORNER: SLOT_COMPOSITION.side,
  TOP_RIGHT:
    "Composition: the subject enters the frame from the top-right corner and is cropped by the top edge and the right edge; one or two small accents may sit lower on the right. The left 45% of the frame and the whole lower-left quarter are completely empty pure white.",
  RIGHT_COLUMN:
    "Composition: the elements are arranged one above another in a tall column in the right 45% of the frame, from near the top to near the bottom, cropped by the right edge. The left 55% of the frame, top to bottom, is completely empty pure white.",
  BOTTOM_BAND:
    "Composition: the elements are arranged side by side in a wide band across the bottom 45% of the frame, from the left edge to the right edge, cropped by the bottom edge. The top 55% of the frame is completely empty pure white.",
} as const;
export type PlacementName = keyof typeof PLACEMENT_COMPOSITION;
const isPlacement = (value: string | undefined): value is PlacementName =>
  value !== undefined && value in PLACEMENT_COMPOSITION;

export const PHOTO_STYLE =
  "Isolated on a pure white seamless background (#FFFFFF), high-key soft diffused studio light, a gentle natural contact shadow, shallow depth of field, saturated natural colors, crisp texture detail, appetizing premium cookbook look. No text.";

export const PHOTO_NEGATIVE =
  "text, letters, numbers, logo, watermark, label, printed packaging, gray stone surface, rustic wooden table, cutting board, linen, dark background, colored backdrop, clutter, decorative props, hands, people, faces, harsh flash, distorted food, frame, border, vignette";

/**
 * Whole subjects (visual-director@7, docs/design/carousel-v3-requirements.md P1): the template
 * measures the subject and places it beside the text (CV-01), so the picture only has to show it
 * whole, with white around it. Used for briefs that name a "vessel".
 */
export const WHOLE_COMPOSITION = {
  CORNER:
    "Composition: the whole subject stands in the right two thirds of the frame with clear white space on every side of it, at least a tenth of the frame free above and below; nothing is cut by the frame's edges. The left third of the frame is empty pure white.",
  TOP_RIGHT:
    "Composition: a tool comes in from the top edge of the frame holding or lifting the food; everything else is whole, in the right two thirds of the frame, with clear white space around and below it. The left third of the frame is empty pure white.",
  RIGHT_COLUMN:
    "Composition: the elements stand one above another in a tall column in the right half of the frame, each one whole and the same size, with white space between and around them and a tenth of the frame free above and below. The left half of the frame is empty pure white.",
  BOTTOM_BAND:
    "Composition: the elements stand side by side in a row across the lower half of the frame, each one whole, with white space between and around them. The upper half of the frame is empty pure white.",
  /** A COMPARISON in the corner: two servings, never one frame split in half. */
  PAIR: "Composition: two separate servings of the same food side by side, the same size, angle and light, each one whole, with white space between and around them, in the right two thirds of the frame; nothing is cut by the frame's edges. The left third of the frame is empty pure white.",
} as const;

export const PHOTO_STYLE_WHOLE =
  "Isolated on a pure white seamless background (#FFFFFF), high-key soft diffused studio light, a soft natural contact shadow, shallow depth of field, realistic appetizing texture, glossy where the food is glossy, saturated natural colors, crisp detail, premium modern cookbook look. No text.";

export const PHOTO_NEGATIVE_WHOLE = `${PHOTO_NEGATIVE}, cropped subject, object cut off by the frame edge, split frame, dark moody lighting`;

export type SlotKind = keyof typeof SLOT_COMPOSITION;

export function slotKind(templateId: string, fullBleed: boolean | undefined): SlotKind {
  if (fullBleed) return "cover";
  return templateId === "C" ? "centred" : "side";
}

/**
 * The subject sentence with the slot's composition (split in two for a comparison) and the style;
 * already finished ones stay.
 */
export function photoPrompt(
  subject: string,
  kind: SlotKind,
  split = false,
  placement?: string,
  whole = false,
): string {
  const text = subject.trim();
  if (text.endsWith(PHOTO_STYLE) || text.endsWith(PHOTO_STYLE_WHOLE)) return text;
  const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
  if (whole && (kind === "side" || kind === "cover")) {
    // The placement decides the shape; a comparison in the corner is two servings. The cover is a
    // corner picture like the others: the white cover (the default) fits it beside the headline.
    const at = kind === "cover" ? "CORNER" : isPlacement(placement) ? placement : "CORNER";
    const composition = at === "CORNER" && split ? WHOLE_COMPOSITION.PAIR : WHOLE_COMPOSITION[at];
    return `${sentence} ${composition} ${PHOTO_STYLE_WHOLE}`;
  }
  if (whole) {
    const composition =
      split && kind === "centred" ? SPLIT_COMPOSITION.centred : SLOT_COMPOSITION[kind];
    return `${sentence} ${composition} ${PHOTO_STYLE_WHOLE}`;
  }
  // An inner slide's placement decides the composition; a split frame only in the corner.
  const composition =
    kind === "side" && isPlacement(placement) && placement !== "CORNER"
      ? PLACEMENT_COMPOSITION[placement]
      : split
        ? SPLIT_COMPOSITION[kind]
        : SLOT_COMPOSITION[kind];
  return `${sentence} ${composition} ${PHOTO_STYLE}`;
}

/** The fixed list plus what the director added for this picture, without repeats. */
export function photoNegative(extra: string | undefined, whole = false): string {
  const fixed = (whole ? PHOTO_NEGATIVE_WHOLE : PHOTO_NEGATIVE).split(", ");
  const known = new Set(fixed.map((t) => t.toLowerCase()));
  const added = (extra ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !known.has(t.toLowerCase()));
  return [...fixed, ...added].join(", ");
}

/**
 * The brief with its generated pictures' prompts finished. Only entries with a `shotType` (from
 * visual-director@4 on) are touched: older briefs carry complete prompts of their own.
 */
export function finishPhotoPrompts(
  brief: VisualBrief,
  slides: readonly Pick<Slide, "id" | "templateId">[],
  templates: Pick<TemplateRegistry, "get">,
): VisualBrief {
  const slideById = new Map(slides.map((s) => [s.id, s]));
  return {
    ...brief,
    slides: brief.slides.map((entry) => {
      if (entry.source !== "GENERATE" || !entry.shotType || !entry.prompt) return entry;
      const slide = slideById.get(entry.slideId);
      if (!slide) return entry;
      const spec = templates.get(slide.templateId)?.imageSlots[entry.slot];
      // visual-director@7 briefs name a vessel: whole subjects, placed by the template.
      const whole = entry.vessel !== undefined;
      return {
        ...entry,
        prompt: photoPrompt(
          entry.prompt,
          slotKind(slide.templateId, spec?.fullBleed),
          entry.shotType === "COMPARISON",
          entry.placement,
          whole,
        ),
        negativePrompt: photoNegative(entry.negativePrompt, whole),
      };
    }),
  };
}
