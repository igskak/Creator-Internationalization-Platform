import { schema } from "@rc/db";
import { and, asc, desc, eq, gte, inArray } from "@rc/db/orm";
import { InvalidStateError } from "@rc/lib/errors";
import type { ideaGenerator } from "@rc/prompts";
import type { ServiceContext } from "../../core";
import {
  type CandidatePoolOptions,
  candidatePool,
  recentPrimaryCardIds,
} from "../../knowledge/retrieval";

// Context of one idea-generation call (plan 07 §7.6.1, §7.9.1, M2-06): the card pool, the ideas of
// the last 60 days, the active offers by priority, the market notes and the taxonomy.

type Input = ideaGenerator.IdeaGeneratorInput;

/** Ideas younger than this are shown to the model so it does not repeat them. */
export const RECENT_IDEAS_DAYS = 60;
/** Upper bound on the recent ideas sent, newest first. */
export const MAX_RECENT_IDEAS = 100;
const MAX_OFFERS = 50;

export type IdeaContextOptions = {
  /** Ideas to ask for, 1–10. */
  count: number;
  /** The editor's focus, free text. */
  focus?: string;
  /** Only cards of these categories enter the pool. */
  categories?: readonly string[];
  /** Only cards in this language enter the pool. */
  language?: string;
  /** Relevance multipliers per category (coverage gaps, performance); see `candidatePool`. */
  categoryWeights?: CandidatePoolOptions["categoryWeights"];
  /** Performance memory text (M7); omitted until there is data. */
  performanceMemory?: string;
};

export type IdeaContext = {
  input: Input;
  pool: { matched: number; exclusionApplied: boolean };
};

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadTaxonomy(ctx: ServiceContext): Promise<Input["taxonomy"]> {
  const rows = await ctx.db
    .select()
    .from(schema.taxonomyTerms)
    .where(
      and(
        inArray(schema.taxonomyTerms.kind, ["category", "angle"]),
        eq(schema.taxonomyTerms.isActive, true),
      ),
    )
    .orderBy(asc(schema.taxonomyTerms.sortOrder), asc(schema.taxonomyTerms.code));
  const of = (kind: string) =>
    rows
      .filter((r) => r.kind === kind)
      .map((r) => ({
        code: r.code,
        label: r.label,
        ...(r.description ? { description: r.description } : {}),
      }));
  return { categories: of("category"), angles: of("angle") };
}

/**
 * Assembles the model input. Cards the idea stage may use come from `candidatePool` without the
 * ones used as PRIMARY in the last 30 days; offers are the ACTIVE offers of ACTIVE products in
 * active markets, highest priority first. Throws InvalidStateError when no approved card with a
 * vector exists, because nothing could be proposed.
 */
export async function buildIdeaContext(
  ctx: ServiceContext,
  options: IdeaContextOptions,
): Promise<IdeaContext> {
  const pool = await candidatePool(ctx, {
    ...(options.categories ? { categories: options.categories } : {}),
    ...(options.language ? { language: options.language } : {}),
    ...(options.categoryWeights ? { categoryWeights: options.categoryWeights } : {}),
    recentlyUsedIds: await recentPrimaryCardIds(ctx),
  });
  if (pool.cards.length === 0) {
    throw new InvalidStateError(
      "There are no approved knowledge cards to build ideas from. Approve some cards first.",
    );
  }

  const since = new Date(ctx.clock.now().getTime() - RECENT_IDEAS_DAYS * DAY_MS);
  const recent = await ctx.db
    .select({
      topic: schema.masterIdeas.topic,
      category: schema.masterIdeas.category,
      angle: schema.masterIdeas.angle,
      coreMessage: schema.masterIdeas.coreMessage,
      status: schema.masterIdeas.status,
    })
    .from(schema.masterIdeas)
    .where(gte(schema.masterIdeas.createdAt, since))
    .orderBy(desc(schema.masterIdeas.createdAt), asc(schema.masterIdeas.id))
    .limit(MAX_RECENT_IDEAS);

  const offers = await ctx.db
    .select({
      productCode: schema.products.code,
      productName: schema.products.name,
      productType: schema.products.type,
      offerName: schema.offers.name,
      offerType: schema.offers.type,
      marketCode: schema.markets.code,
      priority: schema.offers.priority,
    })
    .from(schema.offers)
    .innerJoin(schema.products, eq(schema.products.id, schema.offers.productId))
    .innerJoin(schema.markets, eq(schema.markets.id, schema.offers.marketId))
    .where(
      and(
        eq(schema.offers.status, "ACTIVE"),
        eq(schema.products.status, "ACTIVE"),
        eq(schema.markets.isActive, true),
      ),
    )
    .orderBy(desc(schema.offers.priority), asc(schema.offers.name), asc(schema.offers.id))
    .limit(MAX_OFFERS);

  const markets = await ctx.db
    .select({
      code: schema.markets.code,
      displayName: schema.markets.displayName,
      language: schema.markets.language,
      foodCultureNotes: schema.markets.foodCultureNotes,
      toneNotes: schema.markets.toneNotes,
    })
    .from(schema.markets)
    .where(eq(schema.markets.isActive, true))
    .orderBy(asc(schema.markets.sortOrder), asc(schema.markets.code));

  const input: Input = {
    count: options.count,
    ...(options.focus?.trim() ? { focus: options.focus.trim() } : {}),
    cards: pool.cards,
    recentIdeas: recent,
    offers,
    markets,
    taxonomy: await loadTaxonomy(ctx),
    ...(options.performanceMemory?.trim()
      ? { performanceMemory: options.performanceMemory.trim() }
      : {}),
  };
  return { input, pool: { matched: pool.matched, exclusionApplied: pool.exclusionApplied } };
}
