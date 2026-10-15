import { schema } from "@rc/db";
import { and, desc, eq, gte, lt, sql } from "@rc/db/orm";
import type { ServiceContext } from "../../core";
import { type DateRangeInput, num, parseRange } from "./range";

// Engagement (11 §11.4): per-post rates at D7 (D3 or later as the fallback, flagged), and their
// medians over a window. Rates are per reach; a post with no reach has no rates, and the medians
// leave it out (the tile says how many posts it rests on).

const d = schema.vPublicationDimensions;
const m = schema.vPublicationMetricsD7;

export type PostRates = {
  publicationId: string;
  variantId: string;
  ideaId: string;
  publishedAt: Date;
  marketCode: string;
  format: string;
  hook: string | null;
  hookType: string | null;
  permalink: string | null;
  /** Null until the post has a snapshot at least 72 hours old. */
  metrics: {
    slot: string;
    ageHours: number;
    /** False when D7 is not there yet and an earlier or later snapshot stands in. */
    isExactD7: boolean;
    reach: number | null;
    saves: number | null;
    shares: number | null;
    comments: number | null;
    saveRate: number | null;
    shareRate: number | null;
    commentRate: number | null;
    engagementRate: number | null;
  } | null;
};

export type Engagement = {
  tiles: {
    /** Posts published in the window. */
    posts: number;
    /** Posts with rates (reach known and above 0): what the medians rest on. */
    withRates: number;
    /** Of those, posts measured at D7 exactly; the others are D3 or later. */
    exactD7: number;
    medianSaveRate: number | null;
    medianShareRate: number | null;
    medianCommentRate: number | null;
    medianEngagementRate: number | null;
    medianReach: number | null;
  };
  posts: PostRates[];
};

export async function getEngagement(ctx: ServiceContext, raw: DateRangeInput): Promise<Engagement> {
  const range = parseRange(raw);
  const rows = await ctx.db
    .select({
      publicationId: d.publicationId,
      variantId: d.variantId,
      ideaId: d.masterIdeaId,
      publishedAt: d.publishedAt,
      marketCode: d.marketCode,
      format: d.format,
      hook: schema.contentVariants.hook,
      hookType: d.hookType,
      permalink: schema.publications.permalink,
      slot: m.snapshotSlot,
      ageHours: m.mediaAgeHours,
      isExactD7: m.isExactD7,
      reach: m.reach,
      saves: m.saves,
      shares: m.shares,
      comments: m.comments,
      saveRate: m.saveRate,
      shareRate: m.shareRate,
      commentRate: m.commentRate,
      engagementRate: m.engagementRate,
    })
    .from(d)
    .innerJoin(schema.contentVariants, eq(schema.contentVariants.id, d.variantId))
    .innerJoin(schema.publications, eq(schema.publications.id, d.publicationId))
    .leftJoin(m, eq(m.publicationId, d.publicationId))
    .where(
      and(
        gte(d.publishedAt, range.from),
        lt(d.publishedAt, range.to),
        ...(range.marketId ? [eq(d.marketId, range.marketId)] : []),
      ),
    )
    .orderBy(desc(d.publishedAt));

  const posts: PostRates[] = rows.map((r) => ({
    publicationId: r.publicationId,
    variantId: r.variantId,
    ideaId: r.ideaId,
    publishedAt: r.publishedAt,
    marketCode: r.marketCode,
    format: r.format,
    hook: r.hook,
    hookType: r.hookType,
    permalink: r.permalink,
    metrics:
      r.slot === null
        ? null
        : {
            slot: r.slot,
            ageHours: num(r.ageHours) ?? 0,
            isExactD7: r.isExactD7 === true,
            reach: r.reach,
            saves: r.saves,
            shares: r.shares,
            comments: r.comments,
            saveRate: num(r.saveRate),
            shareRate: num(r.shareRate),
            commentRate: num(r.commentRate),
            engagementRate: num(r.engagementRate),
          },
  }));

  // Medians over the posts that have rates, computed by the database for the same posts.
  const [med] = await ctx.db
    .select({
      withRates: sql<number>`count(*) filter (where ${m.saveRate} is not null)::int`,
      exactD7: sql<number>`count(*) filter (where ${m.saveRate} is not null and ${m.isExactD7})::int`,
      save: sql<string | null>`percentile_cont(0.5) within group (order by ${m.saveRate})`,
      share: sql<string | null>`percentile_cont(0.5) within group (order by ${m.shareRate})`,
      comment: sql<string | null>`percentile_cont(0.5) within group (order by ${m.commentRate})`,
      engagement: sql<
        string | null
      >`percentile_cont(0.5) within group (order by ${m.engagementRate})`,
      reach: sql<string | null>`percentile_cont(0.5) within group (order by ${m.reach})`,
    })
    .from(d)
    .innerJoin(m, eq(m.publicationId, d.publicationId))
    .where(
      and(
        gte(d.publishedAt, range.from),
        lt(d.publishedAt, range.to),
        ...(range.marketId ? [eq(d.marketId, range.marketId)] : []),
      ),
    );

  return {
    tiles: {
      posts: posts.length,
      withRates: Number(med?.withRates ?? 0),
      exactD7: Number(med?.exactD7 ?? 0),
      medianSaveRate: num(med?.save),
      medianShareRate: num(med?.share),
      medianCommentRate: num(med?.comment),
      medianEngagementRate: num(med?.engagement),
      medianReach: num(med?.reach),
    },
    posts,
  };
}
