import { schema } from "@rc/db";
import { and, asc, eq, gte, lte, sql } from "@rc/db/orm";
import type { ServiceContext } from "../../core";
import { type DateRangeInput, dayOf, num, parseRange } from "./range";

// Growth (11 §11.4): followers, follower growth, daily reach, and the share of reach that comes
// from people who do not follow yet. Source: `account_metric_snapshots`, one row per account and
// market-local day. With several accounts (no market chosen) the days are added up.

export type SeriesPoint = { date: string; value: number | null };

export type Growth = {
  tiles: {
    /** Followers on the last day with a count; null when no day has one. */
    followers: number | null;
    /** Last minus first count in the window; null with fewer than two days of counts. */
    followerGrowth: number | null;
    /** Mean daily reach over the days that report it. */
    avgDailyReach: number | null;
    /** Reach from non-followers / all reach with a split, over the window. */
    nonFollowerShare: number | null;
    /** Days of the window that have a snapshot. */
    days: number;
  };
  followersSeries: SeriesPoint[];
  reachSeries: SeriesPoint[];
  nonFollowerShareSeries: SeriesPoint[];
};

export async function getGrowth(ctx: ServiceContext, raw: DateRangeInput): Promise<Growth> {
  const range = parseRange(raw);
  const a = schema.accountMetricSnapshots;
  const lastDay = dayOf(new Date(range.to.getTime() - 1));
  const rows = await ctx.db
    .select({
      date: a.metricDate,
      followers: sql<string | null>`sum(${a.followersCount})`,
      reach: sql<string | null>`sum(${a.reach})`,
      reachFollowers: sql<string | null>`sum(${a.reachFollowers})`,
      reachNonFollowers: sql<string | null>`sum(${a.reachNonFollowers})`,
    })
    .from(a)
    .innerJoin(schema.socialAccounts, eq(schema.socialAccounts.id, a.socialAccountId))
    .where(
      and(
        gte(a.metricDate, dayOf(range.from)),
        lte(a.metricDate, lastDay),
        ...(range.marketId ? [eq(schema.socialAccounts.marketId, range.marketId)] : []),
      ),
    )
    .groupBy(a.metricDate)
    .orderBy(asc(a.metricDate));

  const days = rows.map((r) => ({
    date: r.date,
    followers: num(r.followers),
    reach: num(r.reach),
    reachFollowers: num(r.reachFollowers),
    reachNonFollowers: num(r.reachNonFollowers),
  }));
  const share = (f: number | null, n: number | null) =>
    f === null || n === null || f + n === 0 ? null : n / (f + n);

  const withFollowers = days.filter((d) => d.followers !== null);
  const withReach = days.filter((d) => d.reach !== null);
  const withSplit = days.filter((d) => d.reachFollowers !== null && d.reachNonFollowers !== null);
  const splitFollowers = withSplit.reduce((sum, d) => sum + (d.reachFollowers ?? 0), 0);
  const splitNon = withSplit.reduce((sum, d) => sum + (d.reachNonFollowers ?? 0), 0);
  const first = withFollowers[0];
  const last = withFollowers.at(-1);

  return {
    tiles: {
      followers: last?.followers ?? null,
      followerGrowth:
        first && last && first !== last ? (last.followers ?? 0) - (first.followers ?? 0) : null,
      avgDailyReach: withReach.length
        ? withReach.reduce((sum, d) => sum + (d.reach ?? 0), 0) / withReach.length
        : null,
      nonFollowerShare: share(splitFollowers, splitNon),
      days: days.length,
    },
    followersSeries: days.map((d) => ({ date: d.date, value: d.followers })),
    reachSeries: days.map((d) => ({ date: d.date, value: d.reach })),
    nonFollowerShareSeries: days.map((d) => ({
      date: d.date,
      value: share(d.reachFollowers, d.reachNonFollowers),
    })),
  };
}
