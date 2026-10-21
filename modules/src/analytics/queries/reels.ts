import { schema } from "@rc/db";
import type { VideoMetrics } from "@rc/db/json";
import { and, desc, eq, gte, inArray, lt } from "@rc/db/orm";
import type { ServiceContext } from "../../core";
import { type DateRangeInput, num, parseRange } from "./range";

// Reels (M8-10, plan 18): what the watch metrics of a published Reel say at D7, and how the Reel
// did next to the carousel it was made from. The watch metrics are Instagram's own
// (`ig_reels_avg_watch_time` in milliseconds, `ig_reels_video_view_total_time` in milliseconds,
// `reels_skip_rate` as a percentage of views that left within the first seconds, V-10). From them:
// hook rate = 1 − skip rate, completion = average watch time / the Reel's length. A metric Instagram
// did not give stays null; no number is invented.

const D7_HOURS = 168;
const MIN_AGE_HOURS = 72;

/** What the watch metrics of one snapshot say; every field null when Instagram gave nothing. */
export type ReelWatch = {
  avgWatchSeconds: number | null;
  totalWatchHours: number | null;
  /** Share of views that skipped in the first seconds, 0–1. */
  skipRate: number | null;
  /** 1 − skip rate. */
  hookRate: number | null;
  /** Average watch time over the Reel's length, at most 1. */
  completion: number | null;
};

const numberOf = (metrics: VideoMetrics | null | undefined, key: string): number | null => {
  const v = metrics?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** Reads the watch metrics; `durationMs` is the length of the rendered Reel, when known. */
export function reelWatch(
  metrics: VideoMetrics | null | undefined,
  durationMs: number | null,
): ReelWatch {
  const avgMs = numberOf(metrics, "ig_reels_avg_watch_time");
  const totalMs = numberOf(metrics, "ig_reels_video_view_total_time");
  const skipRaw = numberOf(metrics, "reels_skip_rate");
  // Documented as a percentage; a value already below 1 is taken as a fraction.
  const skipRate =
    skipRaw === null ? null : Math.min(1, Math.max(0, skipRaw > 1 ? skipRaw / 100 : skipRaw));
  return {
    avgWatchSeconds: avgMs === null ? null : avgMs / 1000,
    totalWatchHours: totalMs === null ? null : totalMs / 3_600_000,
    skipRate,
    hookRate: skipRate === null ? null : 1 - skipRate,
    completion: avgMs === null || !durationMs ? null : Math.min(1, avgMs / durationMs),
  };
}

export type ReelInsight = {
  publicationId: string;
  variantId: string;
  ideaId: string;
  marketCode: string;
  publishedAt: Date;
  hook: string | null;
  permalink: string | null;
  durationSeconds: number | null;
  /** The snapshot used: the one closest to D7 among those at least 72 h old; null before that. */
  slot: string | null;
  isExactD7: boolean;
  views: number | null;
  reach: number | null;
  saveRate: number | null;
  shareRate: number | null;
  watch: ReelWatch;
  /** The carousel the Reel was made from, with its D7 numbers (null when it is not published). */
  carousel: {
    publicationId: string;
    reach: number | null;
    saveRate: number | null;
    shareRate: number | null;
  } | null;
};

export type ReelInsights = {
  tiles: {
    reels: number;
    measured: number;
    medianViews: number | null;
    medianAvgWatchSeconds: number | null;
    medianHookRate: number | null;
    medianCompletion: number | null;
    /** Median of Reel reach / its carousel's reach, over the pairs where both are known. */
    medianReachVsCarousel: number | null;
  };
  reels: ReelInsight[];
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};
const rate = (value: number | null, reach: number | null) =>
  value === null || reach === null || reach === 0 ? null : value / reach;

type Snapshot = typeof schema.metricSnapshots.$inferSelect;
/** The same choice as `v_publication_metrics_d7`: closest to 168 h from 72 h on, newest on a tie. */
export function pickD7(snapshots: readonly Snapshot[]): Snapshot | null {
  let best: Snapshot | null = null;
  for (const s of snapshots) {
    const age = num(s.mediaAgeHours) ?? 0;
    if (age < MIN_AGE_HOURS) continue;
    if (!best) {
      best = s;
      continue;
    }
    const d = Math.abs(age - D7_HOURS);
    const bd = Math.abs((num(best.mediaAgeHours) ?? 0) - D7_HOURS);
    if (d < bd || (d === bd && s.measuredAt.getTime() > best.measuredAt.getTime())) best = s;
  }
  return best;
}

/**
 * The snapshot a post's numbers are shown from on the Published list and its lineage: the D7 one
 * (`pickD7`), and before the post is 72 h old the newest snapshot it has (H2, D1 or a manual one),
 * so that the first days are not empty. The comparisons and summaries keep to `pickD7`.
 */
export function pickShown(snapshots: readonly Snapshot[]): Snapshot | null {
  const d7 = pickD7(snapshots);
  if (d7) return d7;
  let best: Snapshot | null = null;
  for (const s of snapshots) {
    if (!best) {
      best = s;
      continue;
    }
    const age = num(s.mediaAgeHours) ?? 0;
    const bestAge = num(best.mediaAgeHours) ?? 0;
    if (age > bestAge || (age === bestAge && s.measuredAt.getTime() > best.measuredAt.getTime()))
      best = s;
  }
  return best;
}

/** A snapshot younger than the 72 h from which the D7 numbers are read. */
export const isEarlySnapshot = (s: Pick<Snapshot, "mediaAgeHours">): boolean =>
  (num(s.mediaAgeHours) ?? 0) < MIN_AGE_HOURS;

export type SnapshotRates = {
  saveRate: number | null;
  shareRate: number | null;
  commentRate: number | null;
  engagementRate: number | null;
};

/** The rates of one snapshot, worked out as `v_publication_metrics_d7` does. */
export function snapshotRates(
  s: Pick<Snapshot, "reach" | "likes" | "comments" | "saves" | "shares" | "totalInteractions">,
): SnapshotRates {
  const interactions =
    s.totalInteractions ??
    (s.likes === null || s.comments === null || s.saves === null || s.shares === null
      ? null
      : s.likes + s.comments + s.saves + s.shares);
  return {
    saveRate: rate(s.saves, s.reach),
    shareRate: rate(s.shares, s.reach),
    commentRate: rate(s.comments, s.reach),
    engagementRate: rate(interactions, s.reach),
  };
}

export async function getReelInsights(
  ctx: ServiceContext,
  raw: DateRangeInput,
): Promise<ReelInsights> {
  const range = parseRange(raw);
  const d = schema.vPublicationDimensions;
  const reels = await ctx.db
    .select({
      publicationId: d.publicationId,
      variantId: d.variantId,
      ideaId: d.masterIdeaId,
      marketCode: d.marketCode,
      publishedAt: d.publishedAt,
      hook: schema.contentVariants.hook,
      sourceVariantId: schema.contentVariants.sourceVariantId,
      permalink: schema.publications.permalink,
      durationMs: schema.reelRenders.durationMs,
    })
    .from(d)
    .innerJoin(schema.contentVariants, eq(schema.contentVariants.id, d.variantId))
    .innerJoin(schema.publications, eq(schema.publications.id, d.publicationId))
    .innerJoin(
      schema.contentVariantVersions,
      eq(schema.contentVariantVersions.id, schema.publications.contentVariantVersionId),
    )
    .leftJoin(
      schema.reelRenders,
      eq(schema.reelRenders.id, schema.contentVariantVersions.reelRenderId),
    )
    .where(
      and(
        eq(d.format, "REEL"),
        gte(d.publishedAt, range.from),
        lt(d.publishedAt, range.to),
        ...(range.marketId ? [eq(d.marketId, range.marketId)] : []),
      ),
    )
    .orderBy(desc(d.publishedAt));

  // The carousels the Reels were made from: their newest published post and its D7 numbers.
  const sourceIds = [
    ...new Set(reels.flatMap((r) => (r.sourceVariantId ? [r.sourceVariantId] : []))),
  ];
  const carouselPubs =
    sourceIds.length === 0
      ? []
      : await ctx.db
          .select({
            publicationId: d.publicationId,
            variantId: d.variantId,
            publishedAt: d.publishedAt,
          })
          .from(d)
          .where(inArray(d.variantId, sourceIds))
          .orderBy(desc(d.publishedAt));
  const carouselOf = new Map<string, string>();
  for (const p of carouselPubs)
    if (!carouselOf.has(p.variantId)) carouselOf.set(p.variantId, p.publicationId);

  const pubIds = [...reels.map((r) => r.publicationId), ...carouselOf.values()];
  const snapshots =
    pubIds.length === 0
      ? []
      : await ctx.db
          .select()
          .from(schema.metricSnapshots)
          .where(inArray(schema.metricSnapshots.publicationId, pubIds));
  const byPub = new Map<string, Snapshot[]>();
  for (const s of snapshots) byPub.set(s.publicationId, [...(byPub.get(s.publicationId) ?? []), s]);

  const insights: ReelInsight[] = reels.map((r) => {
    const s = pickD7(byPub.get(r.publicationId) ?? []);
    const carouselPub = r.sourceVariantId ? carouselOf.get(r.sourceVariantId) : undefined;
    const c = carouselPub ? pickD7(byPub.get(carouselPub) ?? []) : null;
    return {
      publicationId: r.publicationId,
      variantId: r.variantId,
      ideaId: r.ideaId,
      marketCode: r.marketCode,
      publishedAt: r.publishedAt,
      hook: r.hook,
      permalink: r.permalink,
      durationSeconds: r.durationMs ? r.durationMs / 1000 : null,
      slot: s?.snapshotSlot ?? null,
      isExactD7: s?.snapshotSlot === "D7",
      views: s?.views ?? null,
      reach: s?.reach ?? null,
      saveRate: s ? rate(s.saves, s.reach) : null,
      shareRate: s ? rate(s.shares, s.reach) : null,
      watch: reelWatch(s?.videoMetricsJson, r.durationMs),
      carousel: carouselPub
        ? {
            publicationId: carouselPub,
            reach: c?.reach ?? null,
            saveRate: c ? rate(c.saves, c.reach) : null,
            shareRate: c ? rate(c.shares, c.reach) : null,
          }
        : null,
    };
  });

  const measured = insights.filter((i) => i.slot !== null);
  const pick = (f: (i: ReelInsight) => number | null) =>
    median(
      measured.flatMap((i) => {
        const v = f(i);
        return v === null ? [] : [v];
      }),
    );
  return {
    tiles: {
      reels: insights.length,
      measured: measured.length,
      medianViews: pick((i) => i.views),
      medianAvgWatchSeconds: pick((i) => i.watch.avgWatchSeconds),
      medianHookRate: pick((i) => i.watch.hookRate),
      medianCompletion: pick((i) => i.watch.completion),
      medianReachVsCarousel: pick((i) =>
        i.reach !== null && i.carousel?.reach ? i.reach / i.carousel.reach : null,
      ),
    },
    reels: insights,
  };
}
