import { z } from "zod";

// Input and output of the idea generator (plan 07 §7.6.1, §7.7, M2-06). Output ids and codes are
// enums of what this call was given, so the model cannot invent a card, a code or a product.

const Term = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export const MAX_IDEAS_PER_CALL = 10;

export const COMMERCIAL_INTENTS = ["NONE", "LEAD_MAGNET", "PRODUCT_SALE", "NURTURE"] as const;

/** An approved card as the idea stage sees it: a digest, not the full card. */
const CardDigest = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  title: z.string(),
  /** At most about 200 characters. */
  claim: z.string(),
  /** Language of the card (usually ru); ideas are written in English. */
  language: z.string().min(1),
  /** Approved version, for the reader's reference. */
  version: z.number().int().positive(),
});

export const IdeaGeneratorInput = z.object({
  /** How many ideas to propose. */
  count: z.number().int().min(1).max(MAX_IDEAS_PER_CALL),
  /** The editor's focus, free text (a category, a season, a product). Data, not instructions. */
  focus: z.string().optional(),
  /** `candidatePool()` output: the only cards the ideas may cite. */
  cards: z.array(CardDigest).min(1),
  /** Ideas of the last 60 days (any status), to avoid repeating them. */
  recentIdeas: z.array(
    z.object({
      topic: z.string(),
      category: z.string(),
      angle: z.string(),
      coreMessage: z.string(),
      status: z.string(),
    }),
  ),
  /** Active offers, highest priority first; empty when nothing is on sale. */
  offers: z.array(
    z.object({
      productCode: z.string().min(1),
      productName: z.string(),
      productType: z.string(),
      offerName: z.string(),
      offerType: z.enum(["LEAD_MAGNET", "PAID_PRODUCT", "BUNDLE"]),
      marketCode: z.string().min(1),
      priority: z.number().int(),
    }),
  ),
  /** Active markets with their notes: what the idea must work for. */
  markets: z.array(
    z.object({
      code: z.string().min(1),
      displayName: z.string(),
      language: z.string(),
      foodCultureNotes: z.string(),
      toneNotes: z.string(),
    }),
  ),
  taxonomy: z.object({
    categories: z.array(Term).min(1),
    angles: z.array(Term).min(1),
  }),
  /** What performed well and badly (M7). Absent until there is data. */
  performanceMemory: z.string().optional(),
});
export type IdeaGeneratorInput = z.infer<typeof IdeaGeneratorInput>;

const IdeaDraft = z.object({
  topic: z.string(),
  category: z.string(),
  angle: z.string(),
  /** English (D-16), one sentence. */
  coreMessage: z.string(),
  primaryKnowledgeIds: z.array(z.string()),
  supportingKnowledgeIds: z.array(z.string()),
  recommendedFormat: z.literal("CAROUSEL"),
  commercialIntent: z.enum(COMMERCIAL_INTENTS),
  /** Code of one of the offered products; null when the idea sells nothing. */
  productCode: z.string().nullable(),
  /** Why this idea is supported by the cards. */
  rationale: z.string(),
  /** Why now: a coverage gap, a performance pattern or an offer priority. */
  whyNow: z.string(),
  /** How it differs from the recent ideas and from the others in this batch. */
  differsFromRecent: z.string(),
});
export type IdeaDraft = z.infer<typeof IdeaDraft>;

/** Structural schema: ids and codes are plain strings. */
export const IdeaGeneratorOutput = z.object({ ideas: z.array(IdeaDraft) });
export type IdeaGeneratorOutput = z.infer<typeof IdeaGeneratorOutput>;

const oneOf = (codes: readonly string[]) =>
  z.enum(codes as [string, ...string[]]) as unknown as z.ZodType<string>;

/**
 * The schema for one call: ids and codes are enums of what this call was given, at most `count`
 * ideas, at least one primary card per idea. `productCode` can only be null when no offer exists.
 */
export function ideaGeneratorOutputFor(input: IdeaGeneratorInput): z.ZodType<IdeaGeneratorOutput> {
  const cardId = oneOf(input.cards.map((c) => c.id));
  const productCodes = [...new Set(input.offers.map((o) => o.productCode))];
  const idea = z.object({
    topic: z.string().min(1),
    category: oneOf(input.taxonomy.categories.map((t) => t.code)),
    angle: oneOf(input.taxonomy.angles.map((t) => t.code)),
    coreMessage: z.string().min(1),
    primaryKnowledgeIds: z.array(cardId).min(1),
    supportingKnowledgeIds: z.array(cardId),
    recommendedFormat: z.literal("CAROUSEL"),
    commercialIntent: z.enum(COMMERCIAL_INTENTS),
    productCode: productCodes.length > 0 ? oneOf(productCodes).nullable() : z.null(),
    rationale: z.string(),
    whyNow: z.string(),
    differsFromRecent: z.string(),
  });
  return z.object({
    ideas: z.array(idea).max(input.count),
  }) as unknown as z.ZodType<IdeaGeneratorOutput>;
}
