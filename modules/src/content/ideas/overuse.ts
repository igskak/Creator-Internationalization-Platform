import { schema } from "@rc/db";
import { and, eq, gte, inArray, sql } from "@rc/db/orm";
import type { ServiceContext } from "../../core";

// Overused themes and coverage gaps (plan 11 §11.5 steps 3-4, M7-02, M7-05). Deterministic, from
// the database only: the summary builder reports them, and the idea stage turns them into card
// weights so an overused category is drawn less and a neglected one more.

/** Variants that were approved, whatever happened after. */
export const APPROVED_OR_LATER = ["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED"] as const;
export const OVERUSE_WINDOW_DAYS = 21;
/** A theme is overused from this many approved posts in the window… */
export const OVERUSE_MIN_COUNT = 3;
/** …or when it is more than this share of them (counted from OVERUSE_MIN_COUNT posts on). */
export const OVERUSE_SHARE = 0.3;
export const GAP_MIN_CARDS = 5;
export const GAP_WINDOW_DAYS = 30;
/** Card weights the idea stage uses (see `candidatePool`'s `categoryWeights`). */
export const OVERUSED_WEIGHT = 0.5;
export const GAP_WEIGHT = 1.3;

const DAY_MS = 86_400_000;

export type OverusedTheme = { category: string; angle?: string; count: number; windowDays: number };
export type CoverageGap = { category: string; approvedCards: number; postsLast30d: number };

/**
 * Categories (and category + angle pairs) approved at least {@link OVERUSE_MIN_COUNT} times in the
 * last three weeks, or more than {@link OVERUSE_SHARE} of the approvals. With a market, its
 * variants are counted; without one, ideas (an idea approved in two markets counts once).
 */
export async function findOverusedThemes(
  ctx: ServiceContext,
  options: { marketId?: string | null; now?: Date; windowDays?: number } = {},
): Promise<OverusedTheme[]> {
  const windowDays = options.windowDays ?? OVERUSE_WINDOW_DAYS;
  const since = new Date((options.now ?? ctx.clock.now()).getTime() - windowDays * DAY_MS);
  const v = schema.contentVariants;
  const rows = await ctx.db
    .select({
      ideaId: v.masterIdeaId,
      variantId: v.id,
      category: schema.masterIdeas.category,
      angle: schema.masterIdeas.angle,
    })
    .from(v)
    .innerJoin(schema.masterIdeas, eq(schema.masterIdeas.id, v.masterIdeaId))
    .innerJoin(
      schema.contentVariantVersions,
      eq(schema.contentVariantVersions.id, v.approvedVersionId),
    )
    .where(
      and(
        inArray(v.status, [...APPROVED_OR_LATER]),
        gte(schema.contentVariantVersions.approvedAt, since),
        ...(options.marketId ? [eq(v.marketId, options.marketId)] : []),
      ),
    );
  // One unit per variant in a market, per idea across markets.
  const units = new Map<string, { category: string; angle: string }>();
  for (const r of rows) units.set(options.marketId ? r.variantId : r.ideaId, r);
  const total = units.size;
  const overused = (count: number) =>
    count >= OVERUSE_MIN_COUNT || (total >= OVERUSE_MIN_COUNT && count / total > OVERUSE_SHARE);
  const byCategory = new Map<string, number>();
  const byPair = new Map<string, number>();
  for (const u of units.values()) {
    byCategory.set(u.category, (byCategory.get(u.category) ?? 0) + 1);
    const pair = `${u.category}\u0000${u.angle}`;
    byPair.set(pair, (byPair.get(pair) ?? 0) + 1);
  }
  const themes: OverusedTheme[] = [];
  for (const [category, count] of byCategory) {
    if (overused(count)) themes.push({ category, count, windowDays });
  }
  for (const [pair, count] of byPair) {
    const [category = "", angle = ""] = pair.split("\u0000");
    // A pair is only worth naming when it is narrower than its category's entry.
    if (overused(count) && count < (byCategory.get(category) ?? 0)) {
      themes.push({ category, angle, count, windowDays });
    }
  }
  return themes.sort(
    (a, b) =>
      b.count - a.count ||
      a.category.localeCompare(b.category) ||
      (a.angle ?? "").localeCompare(b.angle ?? ""),
  );
}

/**
 * Categories with at least {@link GAP_MIN_CARDS} approved cards and no post in the last 30 days
 * (of the market, or of any market).
 */
export async function findCoverageGaps(
  ctx: ServiceContext,
  options: { marketId?: string | null; now?: Date } = {},
): Promise<CoverageGap[]> {
  const since = new Date((options.now ?? ctx.clock.now()).getTime() - GAP_WINDOW_DAYS * DAY_MS);
  const cards = await ctx.db
    .select({
      category: schema.knowledgeItems.category,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.knowledgeItems)
    .where(eq(schema.knowledgeItems.reviewStatus, "CHEF_APPROVED"))
    .groupBy(schema.knowledgeItems.category);
  const posts = await ctx.db
    .select({ category: schema.masterIdeas.category, n: sql<number>`count(*)::int` })
    .from(schema.publications)
    .innerJoin(
      schema.contentVariants,
      eq(schema.contentVariants.id, schema.publications.contentVariantId),
    )
    .innerJoin(schema.masterIdeas, eq(schema.masterIdeas.id, schema.contentVariants.masterIdeaId))
    .where(
      and(
        eq(schema.publications.status, "PUBLISHED"),
        eq(schema.publications.dryRun, false),
        gte(schema.publications.publishedAt, since),
        ...(options.marketId ? [eq(schema.publications.marketId, options.marketId)] : []),
      ),
    )
    .groupBy(schema.masterIdeas.category);
  const posted = new Map(posts.map((p) => [p.category, Number(p.n)]));
  return cards
    .filter((c) => Number(c.n) >= GAP_MIN_CARDS && (posted.get(c.category) ?? 0) === 0)
    .map((c) => ({ category: c.category, approvedCards: Number(c.n), postsLast30d: 0 }))
    .sort((a, b) => b.approvedCards - a.approvedCards || a.category.localeCompare(b.category));
}

/**
 * Card weights for the idea stage (M7-05): overused categories are drawn half as often, gaps a
 * third more. A category that is both (cannot happen today) keeps the penalty.
 */
export function categoryWeightsFrom(
  overused: readonly OverusedTheme[],
  gaps: readonly CoverageGap[],
): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const g of gaps) weights[g.category] = GAP_WEIGHT;
  for (const t of overused) if (!t.angle) weights[t.category] = OVERUSED_WEIGHT;
  return weights;
}
