import { schema } from "@rc/db";
import { and, eq, gte, inArray, lt, sql } from "@rc/db/orm";
import type { ServiceContext } from "../../core";
import { type DateRangeInput, parseRange } from "./range";

// Commercial (plan 11 §11.4 and §11.7, M6-08): leads, sales and revenue per campaign, offer and
// market in a window, and revenue per 1,000 reach = revenue / Σ D7 reach of the campaign's posts ×
// 1,000. Revenue is kept per currency (one currency per market): sums in different currencies are
// never added up. An event counts in the window of its `occurred_at`; refunds are subtracted.

const a = schema.attributionEvents;

/** Revenue in one currency. */
export type Money = { currency: string; amount: number };

export type CommercialCounts = {
  leads: number;
  sales: number;
  refunds: number;
  /** Sales minus refunds, per currency, largest first. */
  revenue: Money[];
};

export type CampaignRow = CommercialCounts & {
  /** Null for events without a campaign id. */
  campaignId: string | null;
  marketCode: string;
  offerName: string | null;
  /** A post has this campaign id. */
  known: boolean;
  /** The first published post of the campaign (for a link to its lineage). */
  publicationId: string | null;
  hook: string | null;
  /** Σ reach at D7 of the campaign's posts; null when none has numbers yet. */
  reachD7: number | null;
  /** Per currency; null when there is no reach to divide by. */
  revenuePer1kReach: Money[] | null;
};

export type Commercial = {
  totals: CommercialCounts & { revenuePer1kReach: Money[] | null; reachD7: number | null };
  campaigns: CampaignRow[];
  offers: (CommercialCounts & { offerId: string | null; offerName: string | null })[];
  markets: (CommercialCounts & { marketCode: string })[];
};

type Bucket = { leads: number; sales: number; refunds: number; revenue: Map<string, number> };
const bucket = (): Bucket => ({ leads: 0, sales: 0, refunds: 0, revenue: new Map() });
const money = (m: Map<string, number>): Money[] =>
  [...m.entries()]
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
    .sort((x, y) => y.amount - x.amount || x.currency.localeCompare(y.currency));
const counts = (b: Bucket): CommercialCounts => ({
  leads: b.leads,
  sales: b.sales,
  refunds: b.refunds,
  revenue: money(b.revenue),
});
const per1k = (revenue: Money[], reach: number | null): Money[] | null =>
  reach && reach > 0
    ? revenue.map((r) => ({
        currency: r.currency,
        amount: Math.round((r.amount / reach) * 1000 * 100) / 100,
      }))
    : null;

export async function getCommercial(ctx: ServiceContext, raw: DateRangeInput): Promise<Commercial> {
  const range = parseRange(raw);
  const rows = await ctx.db
    .select({
      campaignId: a.campaignId,
      marketId: a.marketId,
      marketCode: schema.markets.code,
      offerId: a.offerId,
      offerName: schema.offers.name,
      type: a.type,
      currency: a.currency,
      quantity: sql<number>`sum(${a.quantity})::int`,
      amount: sql<string | null>`sum(${a.amount})`,
    })
    .from(a)
    .innerJoin(schema.markets, eq(schema.markets.id, a.marketId))
    .leftJoin(schema.offers, eq(schema.offers.id, a.offerId))
    .where(
      and(
        gte(a.occurredAt, range.from),
        lt(a.occurredAt, range.to),
        ...(range.marketId ? [eq(a.marketId, range.marketId)] : []),
      ),
    )
    .groupBy(
      a.campaignId,
      a.marketId,
      schema.markets.code,
      a.offerId,
      schema.offers.name,
      a.type,
      a.currency,
    );

  // The campaigns' posts: the first publication and Σ D7 reach of the published ones.
  const campaignIds = [...new Set(rows.flatMap((r) => (r.campaignId ? [r.campaignId] : [])))];
  const posts =
    campaignIds.length === 0
      ? []
      : await ctx.db
          .select({
            campaignId: schema.contentVariants.campaignId,
            hook: schema.contentVariants.hook,
            publicationId: sql<
              string | null
            >`(array_agg(${schema.publications.id} order by ${schema.publications.publishedAt}) filter (where ${schema.publications.status} = 'PUBLISHED' and ${schema.publications.dryRun} = false))[1]`,
            reach: sql<number | null>`sum(${schema.vPublicationMetricsD7.reach})::int`,
          })
          .from(schema.contentVariants)
          .leftJoin(
            schema.publications,
            eq(schema.publications.contentVariantId, schema.contentVariants.id),
          )
          .leftJoin(
            schema.vPublicationMetricsD7,
            and(
              eq(schema.vPublicationMetricsD7.publicationId, schema.publications.id),
              eq(schema.publications.status, "PUBLISHED"),
              eq(schema.publications.dryRun, false),
            ),
          )
          .where(inArray(schema.contentVariants.campaignId, campaignIds))
          .groupBy(schema.contentVariants.campaignId, schema.contentVariants.hook);
  const postOf = new Map(posts.map((p) => [p.campaignId, p]));

  const total = bucket();
  const byCampaign = new Map<
    string,
    { b: Bucket; campaignId: string | null; marketCode: string; offerName: string | null }
  >();
  const byOffer = new Map<
    string,
    { b: Bucket; offerId: string | null; offerName: string | null }
  >();
  const byMarket = new Map<string, Bucket>();
  for (const r of rows) {
    const qty = Number(r.quantity);
    const amount = r.amount === null ? 0 : Number(r.amount);
    const campaignKey = `${r.campaignId ?? ""}|${r.marketCode}`;
    const c = byCampaign.get(campaignKey) ?? {
      b: bucket(),
      campaignId: r.campaignId,
      marketCode: r.marketCode,
      offerName: r.offerName,
    };
    c.offerName ??= r.offerName;
    byCampaign.set(campaignKey, c);
    const o = byOffer.get(r.offerId ?? "") ?? {
      b: bucket(),
      offerId: r.offerId,
      offerName: r.offerName,
    };
    byOffer.set(r.offerId ?? "", o);
    const mk = byMarket.get(r.marketCode) ?? bucket();
    byMarket.set(r.marketCode, mk);
    for (const target of [total, c.b, o.b, mk]) {
      if (r.type === "LEAD") target.leads += qty;
      if (r.type === "SALE") target.sales += qty;
      if (r.type === "REFUND") target.refunds += qty;
      if (r.currency && r.type !== "LEAD") {
        const sign = r.type === "REFUND" ? -1 : 1;
        target.revenue.set(r.currency, (target.revenue.get(r.currency) ?? 0) + sign * amount);
      }
    }
  }

  const campaigns: CampaignRow[] = [...byCampaign.values()].map((c) => {
    const post = c.campaignId ? postOf.get(c.campaignId) : undefined;
    const reach = post?.reach === null || post?.reach === undefined ? null : Number(post.reach);
    const base = counts(c.b);
    return {
      ...base,
      campaignId: c.campaignId,
      marketCode: c.marketCode,
      offerName: c.offerName,
      known: Boolean(post),
      publicationId: post?.publicationId ?? null,
      hook: post?.hook ?? null,
      reachD7: reach,
      revenuePer1kReach: per1k(base.revenue, reach),
    };
  });
  campaigns.sort(
    (x, y) =>
      (y.revenue[0]?.amount ?? 0) - (x.revenue[0]?.amount ?? 0) ||
      y.sales - x.sales ||
      y.leads - x.leads ||
      (x.campaignId ?? "~").localeCompare(y.campaignId ?? "~"),
  );

  // Revenue per 1,000 reach over the campaigns that have reach only: the others would make the
  // rate look better than it is.
  const measured = campaigns.filter((c) => c.reachD7 !== null && c.reachD7 > 0);
  const measuredReach = measured.reduce((s, c) => s + (c.reachD7 ?? 0), 0);
  const measuredRevenue = new Map<string, number>();
  for (const c of measured) {
    for (const r of c.revenue) {
      measuredRevenue.set(r.currency, (measuredRevenue.get(r.currency) ?? 0) + r.amount);
    }
  }

  return {
    totals: {
      ...counts(total),
      reachD7: measured.length > 0 ? measuredReach : null,
      revenuePer1kReach: per1k(money(measuredRevenue), measuredReach),
    },
    campaigns,
    offers: [...byOffer.values()]
      .map((o) => ({ ...counts(o.b), offerId: o.offerId, offerName: o.offerName }))
      .sort((x, y) => y.sales - x.sales || y.leads - x.leads),
    markets: [...byMarket.entries()]
      .map(([marketCode, b]) => ({ ...counts(b), marketCode }))
      .sort((x, y) => x.marketCode.localeCompare(y.marketCode)),
  };
}
