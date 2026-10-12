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

export const PHOTO_STYLE =
  "Isolated on a pure white seamless background (#FFFFFF), high-key soft diffused studio light, a gentle natural contact shadow, shallow depth of field, saturated natural colors, crisp texture detail, appetizing premium cookbook look. No text.";

export const PHOTO_NEGATIVE =
  "text, letters, numbers, logo, watermark, label, printed packaging, gray stone surface, rustic wooden table, cutting board, linen, dark background, colored backdrop, clutter, decorative props, hands, people, faces, harsh flash, distorted food, frame, border, vignette";

export type SlotKind = keyof typeof SLOT_COMPOSITION;

export function slotKind(templateId: string, fullBleed: boolean | undefined): SlotKind {
  if (fullBleed) return "cover";
  return templateId === "C" ? "centred" : "side";
}

/** The subject sentence with the slot's composition and the style; already finished ones stay. */
export function photoPrompt(subject: string, kind: SlotKind): string {
  const text = subject.trim();
  if (text.endsWith(PHOTO_STYLE)) return text;
  const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
  return `${sentence} ${SLOT_COMPOSITION[kind]} ${PHOTO_STYLE}`;
}

/** The fixed list plus what the director added for this picture, without repeats. */
export function photoNegative(extra: string | undefined): string {
  const fixed = PHOTO_NEGATIVE.split(", ");
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
      return {
        ...entry,
        prompt: photoPrompt(entry.prompt, slotKind(slide.templateId, spec?.fullBleed)),
        negativePrompt: photoNegative(entry.negativePrompt),
      };
    }),
  };
}
