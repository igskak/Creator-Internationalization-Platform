import { CtaSpec, type Slide, Slide as SlideShape, VisualBrief } from "@rc/db/json";
import { ValidationError } from "@rc/lib/errors";
import { z } from "zod";

// FieldPath (plan 04 §4.4): the address of one editable part of a variant, used by review events,
// edits and regeneration. Slides are addressed by their stable id, never by position.
//
//   hook | caption | cta | hashtags | visualBrief
//   slides.<id>                   a whole slide
//   slides.<id>.slots.<slot>      one text slot
//   slides.<id>.images.<slot>     one image slot

export type ParsedFieldPath =
  | { kind: "hook" }
  | { kind: "caption" }
  | { kind: "cta" }
  | { kind: "hashtags" }
  | { kind: "visualBrief" }
  | { kind: "slide"; slideId: string }
  | { kind: "slot"; slideId: string; slot: string }
  | { kind: "image"; slideId: string; slot: string };

const SIMPLE = new Set(["hook", "caption", "cta", "hashtags", "visualBrief"]);
const SLIDE_PATH = /^slides\.([A-Za-z0-9_-]+)(?:\.(slots|images)\.([A-Za-z0-9_-]+))?$/;

/** Returns null for a string that is not a field path. */
export function tryParseFieldPath(path: string): ParsedFieldPath | null {
  if (SIMPLE.has(path)) return { kind: path } as ParsedFieldPath;
  const match = SLIDE_PATH.exec(path);
  if (!match) return null;
  const [, slideId = "", part, slot = ""] = match;
  if (!part) return { kind: "slide", slideId };
  return part === "slots" ? { kind: "slot", slideId, slot } : { kind: "image", slideId, slot };
}

export function parseFieldPath(path: string): ParsedFieldPath {
  const parsed = tryParseFieldPath(path);
  if (!parsed) {
    throw new ValidationError(`"${path}" is not a field of a variant.`, {
      fieldErrors: { field: [`"${path}" is not a field of a variant.`] },
    });
  }
  return parsed;
}

export const formatFieldPath = (field: ParsedFieldPath): string => {
  switch (field.kind) {
    case "slide":
      return `slides.${field.slideId}`;
    case "slot":
      return `slides.${field.slideId}.slots.${field.slot}`;
    case "image":
      return `slides.${field.slideId}.images.${field.slot}`;
    default:
      return field.kind;
  }
};

/** The editable content of a variant (the stored columns, with their JSON shapes). */
export type VariantContent = {
  hook: string;
  caption: string;
  cta: CtaSpec;
  hashtags: string[];
  slides: Slide[];
  visualBrief: VisualBrief | null;
};

export const MAX_HOOK_CHARS = 300;
/** Instagram's own limit (⚠ V-05); the policy of 3–5 is a warning of the validators. */
export const MAX_HASHTAGS_HARD = 30;

const ImageRef = z.object({ assetId: z.string().min(1).optional() });
const HashtagList = z
  .array(z.string().trim().min(1).max(100))
  .max(MAX_HASHTAGS_HARD, `At most ${MAX_HASHTAGS_HARD} hashtags.`);

/** The shape of the value each kind of field takes. */
export function valueSchema(field: ParsedFieldPath): z.ZodType {
  switch (field.kind) {
    case "hook":
      return z.string().trim().min(1, "The hook cannot be empty.").max(MAX_HOOK_CHARS);
    case "caption":
      return z.string().trim().min(1, "The caption cannot be empty.");
    case "cta":
      return CtaSpec;
    case "hashtags":
      return HashtagList;
    case "visualBrief":
      return VisualBrief;
    case "slide":
      return SlideShape;
    case "slot":
      return z.string();
    case "image":
      return ImageRef;
  }
}

const findSlide = (content: VariantContent, slideId: string): Slide => {
  const slide = content.slides.find((s) => s.id === slideId);
  if (!slide) {
    throw new ValidationError(`There is no slide "${slideId}".`, {
      fieldErrors: { field: [`There is no slide "${slideId}".`] },
    });
  }
  return slide;
};

/** The current value of a field; throws ValidationError when the slide does not exist. */
export function readField(content: VariantContent, field: ParsedFieldPath): unknown {
  switch (field.kind) {
    case "hook":
      return content.hook;
    case "caption":
      return content.caption;
    case "cta":
      return content.cta;
    case "hashtags":
      return content.hashtags;
    case "visualBrief":
      return content.visualBrief;
    case "slide":
      return findSlide(content, field.slideId);
    case "slot":
      return findSlide(content, field.slideId).slots[field.slot] ?? null;
    case "image":
      return findSlide(content, field.slideId).images[field.slot] ?? null;
  }
}

/** A copy of `content` with the field set to `value` (already checked against `valueSchema`). */
export function writeField(
  content: VariantContent,
  field: ParsedFieldPath,
  value: unknown,
): VariantContent {
  const next = structuredClone(content);
  const slide = (): Slide => findSlide(next, (field as { slideId: string }).slideId);
  switch (field.kind) {
    case "hook":
      next.hook = value as string;
      break;
    case "caption":
      next.caption = value as string;
      break;
    case "cta":
      next.cta = value as CtaSpec;
      break;
    case "hashtags":
      next.hashtags = value as string[];
      break;
    case "visualBrief":
      next.visualBrief = value as VisualBrief;
      break;
    case "slide": {
      const current = slide();
      const incoming = value as Slide;
      if (incoming.id !== current.id) {
        throw new ValidationError("A slide keeps its id.", {
          fieldErrors: { value: ["A slide keeps its id."] },
        });
      }
      next.slides = next.slides.map((s) =>
        s.id === current.id ? { ...incoming, index: s.index } : s,
      );
      break;
    }
    case "slot":
      slide().slots[field.slot] = value as string;
      break;
    case "image": {
      const ref = value as { assetId?: string };
      if (ref.assetId) slide().images[field.slot] = { assetId: ref.assetId };
      else slide().images[field.slot] = {};
      break;
    }
  }
  return next;
}

/** Whether a change to this field changes the pictures (and so needs a new render). */
export const affectsRender = (field: ParsedFieldPath): boolean =>
  field.kind === "slide" || field.kind === "slot" || field.kind === "image";

/** Whether `issuePath` is the field itself or inside it (`slides.s1` covers `slides.s1.slots.body`). */
export function isWithin(issuePath: string | undefined, field: ParsedFieldPath): boolean {
  if (!issuePath) return false;
  const path = formatFieldPath(field);
  return issuePath === path || issuePath.startsWith(`${path}.`);
}
