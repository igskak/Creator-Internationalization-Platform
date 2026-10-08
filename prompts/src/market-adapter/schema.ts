import { z } from "zod";

// Input and output of the market adapter (plan 07 §7.6.1, §7.6.4, §7.7, M2-09). The output is the
// `MarketBrief` of `@rc/db/json`; @rc/prompts is pure, so the shape is repeated here and a test in
// @rc/modules keeps the two equal. Ids and codes in the output are enums of what the call was given.

/** Same list as `SLIDE_ROLES` in db/src/json/content.ts. */
export const SLIDE_ROLES = [
  "HOOK",
  "PROBLEM",
  "EXPLANATION",
  "STEP",
  "MISTAKE",
  "CORRECT",
  "FACT",
  "COMPARISON",
  "SUMMARY",
  "CTA",
] as const;
export const TEMPLATE_IDS = ["A", "B", "C", "D", "E", "F"] as const;
export const UNIT_SYSTEMS = ["METRIC", "IMPERIAL", "DUAL"] as const;
export const MIN_SLIDES = 5;
export const MAX_SLIDES = 10;

const Term = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

/** The approved text of a card, exactly as the idea was built on it (closed book). */
const Card = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  /** Language of the card text (usually ru). */
  language: z.string().min(1),
  role: z.enum(["PRIMARY", "SUPPORTING"]),
  title: z.string(),
  category: z.string(),
  claim: z.string(),
  explanation: z.string().default(""),
  procedure: z.array(z.object({ n: z.number().int(), text: z.string() })).default([]),
  ingredients: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.number().optional(),
        unit: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  temperatures: z
    .array(
      z.object({
        value: z.number(),
        unit: z.enum(["C", "F"]),
        target: z.string().optional(),
        context: z.string().optional(),
      }),
    )
    .default([]),
  timings: z
    .array(
      z.object({
        value: z.number(),
        valueMax: z.number().optional(),
        unit: z.string(),
        context: z.string().optional(),
      }),
    )
    .default([]),
  commonMistakes: z
    .array(
      z.object({ mistake: z.string(), why: z.string().optional(), fix: z.string().optional() }),
    )
    .default([]),
  safetySensitive: z.boolean().default(false),
  safetyNotes: z.string().nullish(),
});

/** One line of the deterministic conversion table (`buildConversionTable`, 07 §7.9.3). */
const ConversionLine = z.object({
  cardId: z.string().min(1),
  kind: z.enum(["TEMPERATURE", "TIMING", "INGREDIENT"]),
  label: z.string(),
  /** The value as the card states it. */
  source: z.string(),
  /** The exact string to use in this market. */
  display: z.string(),
});

const Sibling = z.object({
  marketCode: z.string().min(1),
  hookType: z.string().min(1),
  audienceFraming: z.string().default(""),
  culturalHooks: z.array(z.string()).default([]),
  slidePlan: z.array(
    z.object({ role: z.enum(SLIDE_ROLES), templateId: z.enum(TEMPLATE_IDS), purpose: z.string() }),
  ),
});

export const MarketAdapterInput = z.object({
  idea: z.object({
    topic: z.string(),
    category: z.string(),
    angle: z.string(),
    /** English (D-16). */
    coreMessage: z.string(),
    evidenceSummary: z.string().default(""),
    commercialIntent: z.enum(["NONE", "LEAD_MAGNET", "PRODUCT_SALE", "NURTURE"]),
  }),
  cards: z.array(Card).min(1),
  market: z.object({
    code: z.string().min(1),
    displayName: z.string(),
    /** ISO 639-1 of the copy: es, en. */
    language: z.string().min(1),
    country: z.string(),
    measurementSystem: z.enum(UNIT_SYSTEMS),
    toneNotes: z.string(),
    foodCultureNotes: z.string(),
    preferredVocabulary: z.array(
      z.object({
        concept: z.string(),
        preferred: z.string(),
        avoid: z.array(z.string()).default([]),
        note: z.string().optional(),
      }),
    ),
    forbiddenPatterns: z.array(
      z.object({ pattern: z.string(), kind: z.enum(["PHRASE", "REGEX"]), reason: z.string() }),
    ),
  }),
  /** The only offer the CTA may point at, in this market; absent when the idea sells nothing. */
  offer: z
    .object({
      name: z.string(),
      type: z.enum(["LEAD_MAGNET", "PAID_PRODUCT", "BUNDLE"]),
      defaultKeyword: z.string().nullish(),
    })
    .optional(),
  conversions: z.array(ConversionLine),
  /** Plans of the markets generated before this one: this plan must not copy them. */
  siblingPlans: z.array(Sibling),
  /** Text from `renderTemplateCatalog()`; only these templates may be planned. */
  templateCatalog: z.string().min(1),
  /** The templates of that catalog with the roles each can carry. */
  templates: z
    .array(z.object({ id: z.enum(TEMPLATE_IDS), roles: z.array(z.enum(SLIDE_ROLES)).min(1) }))
    .min(1),
  taxonomy: z.object({ hookTypes: z.array(Term).min(1), ctaTypes: z.array(Term).min(1) }),
});
export type MarketAdapterInput = z.infer<typeof MarketAdapterInput>;

const structural = z.object({
  audienceFraming: z.string(),
  terminology: z.array(
    z.object({
      concept: z.string().min(1),
      localTerm: z.string().min(1),
      avoid: z.array(z.string()),
    }),
  ),
  substitutions: z.array(
    z.object({
      original: z.string().min(1),
      local: z.string().min(1),
      note: z.string(),
      factualImpact: z.enum(["NONE", "NEEDS_CHECK"]),
    }),
  ),
  unitsPolicy: z.object({
    system: z.enum(UNIT_SYSTEMS),
    conversions: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
  }),
  culturalHooks: z.array(z.string()),
  examples: z.array(z.string()),
  tone: z.string(),
  hookType: z.string().min(1),
  slidePlan: z.array(
    z.object({
      role: z.enum(SLIDE_ROLES),
      templateId: z.enum(TEMPLATE_IDS),
      purpose: z.string(),
      knowledgeIds: z.array(z.string().min(1)),
    }),
  ),
  ctaApproach: z.object({
    ctaType: z.string().min(1),
    keywordSuggestion: z.string().min(1).optional(),
  }),
  risks: z.array(z.string()),
  differentiationNotes: z.string(),
});

/** Structural schema: the `MarketBrief` of `@rc/db/json`. */
export const MarketAdapterOutput = structural;
export type MarketAdapterOutput = z.infer<typeof MarketAdapterOutput>;

const oneOf = (codes: readonly string[]) =>
  z.enum(codes as [string, ...string[]]) as unknown as z.ZodType<string>;

/**
 * The schema for one call: hook and CTA types are the taxonomy codes given, templates the ones in
 * the catalog, card ids the ones of this idea, and the unit system is the market's. The slide
 * count (5–10), the HOOK first and the role-template fit are checked by the validators, so a
 * violation yields a precise repair message instead of a parse failure.
 */
export function marketAdapterOutputFor(input: MarketAdapterInput): z.ZodType<MarketAdapterOutput> {
  const cardId = oneOf(input.cards.map((c) => c.id));
  return structural.extend({
    unitsPolicy: z.object({
      system: z.literal(input.market.measurementSystem),
      conversions: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
    }),
    hookType: oneOf(input.taxonomy.hookTypes.map((t) => t.code)),
    slidePlan: z.array(
      z.object({
        role: z.enum(SLIDE_ROLES),
        templateId: oneOf(input.templates.map((t) => t.id)),
        purpose: z.string(),
        knowledgeIds: z.array(cardId),
      }),
    ),
    ctaApproach: z.object({
      ctaType: oneOf(input.taxonomy.ctaTypes.map((t) => t.code)),
      keywordSuggestion: z.string().min(1).optional(),
    }),
  }) as unknown as z.ZodType<MarketAdapterOutput>;
}
