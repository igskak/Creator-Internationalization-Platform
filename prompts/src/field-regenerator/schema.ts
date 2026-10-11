import { z } from "zod";
import { ContentWriterInput } from "../content-writer/schema";
import { SLIDE_ROLES, TEMPLATE_IDS } from "../market-adapter/schema";

// Input and output of the field regenerator (plan 07 §7.6.1, §7.7, M4-04): one field of a draft
// that a reviewer wants redone, with the rest of the draft as context. The value in the answer has
// the shape of the field's kind; `outputFor` builds the schema of that one call.

export const FIELD_KINDS = [
  "hook",
  "caption",
  "cta",
  "hashtags",
  "slide",
  "slot",
  "image",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

const CurrentSlide = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  role: z.enum(SLIDE_ROLES),
  templateId: z.enum(TEMPLATE_IDS),
  slots: z.array(z.object({ slot: z.string().min(1), text: z.string() })),
  knowledgeIds: z.array(z.string().min(1)),
  factual: z.boolean(),
  altText: z.string().optional(),
});

export const FieldRegeneratorInput = ContentWriterInput.pick({
  brandVoice: true,
  idea: true,
  cards: true,
  market: true,
  brief: true,
  conversions: true,
  offer: true,
  templates: true,
  siblingSummary: true,
  taxonomy: true,
}).extend({
  /** The draft as it is now; only `field` changes. */
  draft: z.object({
    hook: z.string(),
    hookType: z.string(),
    caption: z.string(),
    cta: z.object({ type: z.string(), text: z.string(), keyword: z.string().optional() }),
    hashtags: z.array(z.string()),
    slides: z.array(CurrentSlide).min(1),
  }),
  field: z.object({
    /** FieldPath (04 §4.4), echoed in the answer. */
    path: z.string().min(1),
    kind: z.enum(FIELD_KINDS),
    slideId: z.string().min(1).optional(),
    slot: z.string().min(1).optional(),
  }),
  /** The picture the slot has now (kind `image`). */
  image: z
    .object({
      prompt: z.string(),
      negativePrompt: z.string().optional(),
      composition: z.string(),
      aspect: z.string(),
      style: z.string(),
    })
    .optional(),
  /** The reviewer's note, at most 500 characters. */
  instruction: z.string().max(500).optional(),
  /** Why the reviewer wants it redone (a reason code and its label). */
  reason: z.object({ code: z.string().min(1), label: z.string() }).optional(),
});
export type FieldRegeneratorInput = z.infer<typeof FieldRegeneratorInput>;

/** A new picture prompt for one image slot. */
export const ImageValue = z.object({
  prompt: z.string(),
  negativePrompt: z.string(),
  composition: z.string(),
});
export type ImageValue = z.infer<typeof ImageValue>;

/** Structural schema (07 §7.7); the `value` is typed per kind by `fieldRegeneratorOutputFor`. */
export const FieldRegeneratorOutput = z.object({
  field: z.string(),
  value: z.unknown(),
  rationale: z.string(),
});
export type FieldRegeneratorOutput = z.infer<typeof FieldRegeneratorOutput>;

const oneOf = (codes: readonly string[]) =>
  z.enum(codes as [string, ...string[]]) as unknown as z.ZodType<string>;

function valueFor(input: FieldRegeneratorInput): z.ZodType {
  switch (input.field.kind) {
    case "hook":
    case "caption":
    case "slot":
      return z.string();
    case "hashtags":
      return z.array(z.string());
    case "cta":
      return z.object({
        type: oneOf(input.taxonomy.ctaTypes.map((t) => t.code)),
        text: z.string(),
        keyword: z.string().min(1).optional(),
      });
    case "slide": {
      const slotNames = [
        ...new Set(input.templates.flatMap((t) => t.textSlots.map((s) => s.name))),
      ];
      return z.object({
        role: z.enum(SLIDE_ROLES),
        templateId: oneOf(input.templates.map((t) => t.id)),
        slots: z.array(z.object({ slot: oneOf(slotNames), text: z.string() })),
        knowledgeIds: z.array(oneOf(input.cards.map((c) => c.id))),
        factual: z.boolean(),
        altText: z.string(),
      });
    }
    case "image":
      return ImageValue;
  }
}

/** The schema for one call: `field` is the given path and `value` has the shape of its kind. */
export function fieldRegeneratorOutputFor(
  input: FieldRegeneratorInput,
): z.ZodType<FieldRegeneratorOutput> {
  return z.object({
    field: z.literal(input.field.path),
    value: valueFor(input),
    rationale: z.string(),
  }) as unknown as z.ZodType<FieldRegeneratorOutput>;
}
