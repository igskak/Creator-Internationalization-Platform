import { z } from "zod";
import { MarketAdapterOutput, SLIDE_ROLES, TEMPLATE_IDS } from "../market-adapter/schema";

// Input and output of the content writer (plan 07 §7.6.1, §7.6.4, §7.7, M2-10). The output holds
// slots as `{ slot, text }[]` (no free-key records, 07 §7.4); code turns it into the stored
// `Slide` shape. Card ids, templates, slot names and codes are enums of what the call was given.

export const MAX_HASHTAGS_ASKED = 5;
export const MIN_HASHTAGS_ASKED = 3;
export const MAX_CAPTION_CHARS = 2200;

const Card = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  language: z.string().min(1),
  role: z.enum(["PRIMARY", "SUPPORTING"]),
  title: z.string(),
  claim: z.string(),
  explanation: z.string().default(""),
  procedure: z.array(z.object({ n: z.number().int(), text: z.string() })).default([]),
  commonMistakes: z
    .array(
      z.object({ mistake: z.string(), why: z.string().optional(), fix: z.string().optional() }),
    )
    .default([]),
  safetySensitive: z.boolean().default(false),
  safetyNotes: z.string().nullish(),
});

const TextSlot = z.object({
  name: z.string().min(1),
  maxChars: z.number().int().positive(),
  maxLines: z.number().int().positive(),
  required: z.boolean(),
});

const Exemplar = z.object({
  /** EXEMPLAR: an approved text of this market; EDIT_PAIR: before → after of a reviewer's edit; RULE: a standing instruction. */
  kind: z.enum(["EXEMPLAR", "EDIT_PAIR", "RULE"]),
  text: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  /** Reason code or note of the reviewer. */
  note: z.string().optional(),
});

export const ContentWriterInput = z.object({
  /** Markdown voice guide of the brand (`brands.brand_voice`). */
  brandVoice: z.string(),
  idea: z.object({
    topic: z.string(),
    /** English (D-16). */
    coreMessage: z.string(),
    commercialIntent: z.enum(["NONE", "LEAD_MAGNET", "PRODUCT_SALE", "NURTURE"]),
  }),
  cards: z.array(Card).min(1),
  market: z.object({
    code: z.string().min(1),
    displayName: z.string(),
    /** ISO 639-1 of the copy to write. */
    language: z.string().min(1),
    measurementSystem: z.enum(["METRIC", "IMPERIAL", "DUAL"]),
    toneNotes: z.string(),
    foodCultureNotes: z.string(),
    preferredVocabulary: z.array(
      z.object({
        concept: z.string(),
        preferred: z.string(),
        avoid: z.array(z.string()).default([]),
      }),
    ),
    forbiddenPatterns: z.array(
      z.object({ pattern: z.string(), kind: z.enum(["PHRASE", "REGEX"]), reason: z.string() }),
    ),
  }),
  /** The plan of the market adapter this draft follows. */
  brief: MarketAdapterOutput,
  /** Exact strings for the numbers of the cards (07 §7.9.3). */
  conversions: z.array(
    z.object({
      cardId: z.string().min(1),
      kind: z.enum(["TEMPERATURE", "TIMING", "INGREDIENT"]),
      label: z.string(),
      source: z.string(),
      display: z.string(),
    }),
  ),
  /** The only offer the CTA may name; absent when the idea sells nothing. */
  offer: z
    .object({
      name: z.string(),
      type: z.enum(["LEAD_MAGNET", "PAID_PRODUCT", "BUNDLE"]),
      keyword: z.string().nullish(),
    })
    .optional(),
  /** Templates the plan uses, with their text-slot limits (from the template registry). */
  templates: z
    .array(
      z.object({
        id: z.enum(TEMPLATE_IDS),
        roles: z.array(z.enum(SLIDE_ROLES)).min(1),
        textSlots: z.array(TextSlot).min(1),
      }),
    )
    .min(1),
  /** Hook and gist of the plans of the other markets, so this draft does not echo them. */
  siblingSummary: z
    .array(z.object({ marketCode: z.string().min(1), hook: z.string(), gist: z.string() }))
    .default([]),
  exemplars: z.array(Exemplar).default([]),
  taxonomy: z.object({
    hookTypes: z.array(z.object({ code: z.string().min(1), label: z.string() })).min(1),
    ctaTypes: z.array(z.object({ code: z.string().min(1), label: z.string() })).min(1),
  }),
  /** A rewrite after the critic: the previous draft and what to change. */
  rewrite: z.object({ instructions: z.string(), previous: z.string() }).optional(),
});
export type ContentWriterInput = z.infer<typeof ContentWriterInput>;

const writerShape = {
  hook: z.string(),
  hookType: z.string().min(1),
  slides: z.array(
    z.object({
      role: z.enum(SLIDE_ROLES),
      templateId: z.enum(TEMPLATE_IDS),
      slots: z.array(z.object({ slot: z.string().min(1), text: z.string() })),
      knowledgeIds: z.array(z.string().min(1)),
      factual: z.boolean(),
      altText: z.string(),
    }),
  ),
  caption: z.string(),
  cta: z.object({
    type: z.string().min(1),
    text: z.string(),
    keyword: z.string().min(1).optional(),
  }),
  hashtags: z.array(z.string()),
  claimsUsed: z.array(z.object({ text: z.string(), knowledgeIds: z.array(z.string().min(1)) })),
};

/** Structural schema (07 §7.7 WriterOutput). */
export const ContentWriterOutput = z.object(writerShape);
export type ContentWriterOutput = z.infer<typeof ContentWriterOutput>;

const oneOf = (codes: readonly string[]) =>
  z.enum(codes as [string, ...string[]]) as unknown as z.ZodType<string>;

/**
 * The schema for one call: card ids, templates, slot names and the hook and CTA types are the ones
 * given. Which slots a template has, their length and the slide count are checked by the
 * validators (7.8), so a violation gives a repair message, not a parse failure.
 */
export function contentWriterOutputFor(input: ContentWriterInput): z.ZodType<ContentWriterOutput> {
  const cardId = oneOf(input.cards.map((c) => c.id));
  const slotNames = [...new Set(input.templates.flatMap((t) => t.textSlots.map((s) => s.name)))];
  return z.object({
    ...writerShape,
    hookType: oneOf(input.taxonomy.hookTypes.map((t) => t.code)),
    slides: z.array(
      z.object({
        role: z.enum(SLIDE_ROLES),
        templateId: oneOf(input.templates.map((t) => t.id)),
        slots: z.array(z.object({ slot: oneOf(slotNames), text: z.string() })),
        knowledgeIds: z.array(cardId),
        factual: z.boolean(),
        altText: z.string(),
      }),
    ),
    cta: z.object({
      type: oneOf(input.taxonomy.ctaTypes.map((t) => t.code)),
      text: z.string(),
      keyword: z.string().min(1).optional(),
    }),
    claimsUsed: z.array(z.object({ text: z.string(), knowledgeIds: z.array(cardId) })),
  }) as unknown as z.ZodType<ContentWriterOutput>;
}
