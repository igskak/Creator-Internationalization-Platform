import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { z } from "zod";
import type { ServiceContext } from "../core";
import { InstagramCallError } from "./errors";
import type { GraphClient } from "./http";

// The Insights calls (plan 09 §9.5, 11 §11.2, M6-02, V-10 and V-11, read from Meta's docs on
// 2026-10-15). Instagram specifics live here and nowhere else: metric names, the lists per media
// type, the answer shapes, the unsupported-metric handling. Anything Instagram does not report is
// null, never 0: the docs say an empty data set comes back "instead of 0".
//
// Not verified against the live API yet (the docs are silent): the error Instagram gives for a metric
// a media type does not support (taken to be code 100 with the metric's name in the text), the
// day boundary of account metrics, and whether a carousel parent takes the FEED list. The code is
// built to survive each of them: an unsupported metric is dropped and remembered, a day is read
// as a total over an explicit window, and every call stands alone.

/** `media_product_type` as far as Insights is concerned: a carousel parent is a FEED post. */
export type InsightsMediaType = "FEED" | "REELS";

/** Metrics asked for in one plain call, per media type. `saved` is stored as `saves`. */
export const MEDIA_METRICS: Record<InsightsMediaType, readonly string[]> = {
  FEED: [
    "reach",
    "views",
    "likes",
    "comments",
    "saved",
    "shares",
    "total_interactions",
    "follows",
    "profile_visits",
  ],
  REELS: [
    "reach",
    "views",
    "likes",
    "comments",
    "saved",
    "shares",
    "total_interactions",
    "ig_reels_avg_watch_time",
    "ig_reels_video_view_total_time",
    "reels_skip_rate",
  ],
};

/** Reels-only watch metrics: they go to `video_metrics_json`. */
export const REEL_VIDEO_METRICS = [
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
  "reels_skip_rate",
] as const;

const Value = z.object({ value: z.unknown().optional() }).passthrough();
const Item = z
  .object({
    name: z.string(),
    values: z.array(Value).optional(),
    total_value: z
      .object({
        value: z.unknown().optional(),
        breakdowns: z
          .array(
            z.object({
              dimension_keys: z.array(z.string()).optional(),
              results: z
                .array(
                  z.object({
                    dimension_values: z.array(z.string()).default([]),
                    value: z.unknown().optional(),
                  }),
                )
                .default([]),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();
const Reply = z.object({ data: z.array(Item).default([]) }).passthrough();
type InsightItem = z.infer<typeof Item>;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** The number of an item (`values[0].value`, or `total_value.value`); null when there is none. */
function itemValue(item: InsightItem | undefined): number | null {
  if (!item) return null;
  return asNumber(item.values?.[0]?.value ?? item.total_value?.value);
}

/** The breakdown of an item as `{ dimension value: number }`, e.g. `{ FOLLOWER: 80 }`. */
function itemBreakdown(item: InsightItem | undefined): Record<string, number> | null {
  const results = item?.total_value?.breakdowns?.[0]?.results;
  if (!results || results.length === 0) return null;
  const out: Record<string, number> = {};
  for (const r of results) {
    const key = r.dimension_values.join("/").toUpperCase();
    const value = asNumber(r.value);
    if (key && value !== null) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The error Instagram gives for a metric that a media type or account does not support. Meta does
 * not document it; third parties report code 100 with the metric in the text.
 */
export function isUnsupportedMetricError(error: InstagramCallError): boolean {
  const e = error.error;
  return e.code === 100 && (e.httpStatus ?? 400) < 500 && /metric/i.test(e.message);
}

// --- Media -------------------------------------------------------------------------------------

export type MediaInsights = {
  /** Every metric asked for (not known to be unsupported), by Instagram's name; null = not reported. */
  metrics: Record<string, number | null>;
  /** `profile_activity` by action (BIO_LINK_CLICKED, CALL, …); null when not asked for or not reported. */
  profileActivity: Record<string, number> | null;
  /** Metrics found unsupported by this call (they are left out of `metrics`). */
  newlyUnsupported: string[];
  /** The answers as received, for `raw_metrics_json`. */
  raw: Record<string, unknown>;
};

const MAX_DROPS = 4;

/**
 * One media's insights. `skip` are metrics already known to be unsupported for this media type
 * (the cached availability): they are not asked for. A metric Instagram refuses is dropped and the
 * call is made again; when the refusal does not name which metric, each metric is asked alone once.
 */
export async function getMediaInsights(
  client: GraphClient,
  mediaId: string,
  mediaType: InsightsMediaType,
  skip: ReadonlySet<string> = new Set(),
): Promise<MediaInsights> {
  let wanted = MEDIA_METRICS[mediaType].filter((m) => !skip.has(m));
  const newlyUnsupported: string[] = [];
  const raw: Record<string, unknown> = {};
  const metrics: Record<string, number | null> = {};

  const read = (reply: unknown, asked: readonly string[]) => {
    const items = new Map(Reply.parse(reply).data.map((i) => [i.name, i]));
    for (const name of asked) metrics[name] = itemValue(items.get(name));
  };

  for (let drops = 0; wanted.length > 0; drops += 1) {
    try {
      const reply = await client.get(`/${mediaId}/insights`, { metric: wanted.join(",") });
      raw.metrics = reply;
      read(reply, wanted);
      break;
    } catch (error) {
      if (!(error instanceof InstagramCallError) || !isUnsupportedMetricError(error)) throw error;
      const named = wanted.filter((m) => error.error.message.includes(m));
      if (named.length > 0 && named.length < wanted.length && drops < MAX_DROPS) {
        newlyUnsupported.push(...named);
        wanted = wanted.filter((m) => !named.includes(m));
        continue;
      }
      // The text does not say which one: ask for each alone, once.
      const singles: Record<string, unknown> = {};
      for (const metric of wanted) {
        try {
          const reply = await client.get(`/${mediaId}/insights`, { metric });
          singles[metric] = reply;
          read(reply, [metric]);
        } catch (single) {
          if (!(single instanceof InstagramCallError) || !isUnsupportedMetricError(single)) {
            throw single;
          }
          newlyUnsupported.push(metric);
        }
      }
      raw.metrics = singles;
      break;
    }
  }

  let profileActivity: Record<string, number> | null = null;
  if (mediaType === "FEED" && !skip.has("profile_activity")) {
    try {
      const reply = await client.get(`/${mediaId}/insights`, {
        metric: "profile_activity",
        breakdown: "action_type",
      });
      raw.profileActivity = reply;
      profileActivity = itemBreakdown(Reply.parse(reply).data[0]);
    } catch (error) {
      if (!(error instanceof InstagramCallError) || !isUnsupportedMetricError(error)) throw error;
      newlyUnsupported.push("profile_activity");
    }
  }
  return { metrics, profileActivity, newlyUnsupported, raw };
}

/** The columns of `metric_snapshots` that a media's insights fill. */
export type SnapshotColumns = {
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  totalInteractions: number | null;
  followerChange: number | null;
  profileActionsJson: {
    profileVisits: number | null;
    follows: number | null;
    profileActivity?: Record<string, number>;
  } | null;
  videoMetricsJson: Record<string, number | null> | null;
};

/** Instagram's names to our columns. A missing metric stays null. */
export function toSnapshotColumns(
  insights: MediaInsights,
  mediaType: InsightsMediaType,
): SnapshotColumns {
  const m = insights.metrics;
  const get = (name: string) => m[name] ?? null;
  const profile =
    mediaType === "FEED"
      ? {
          profileVisits: get("profile_visits"),
          follows: get("follows"),
          ...(insights.profileActivity ? { profileActivity: insights.profileActivity } : {}),
        }
      : null;
  const hasProfile =
    profile !== null &&
    (profile.profileVisits !== null || profile.follows !== null || profile.profileActivity);
  const video =
    mediaType === "REELS"
      ? Object.fromEntries(REEL_VIDEO_METRICS.map((name) => [name, get(name)]))
      : null;
  return {
    reach: get("reach"),
    views: get("views"),
    likes: get("likes"),
    comments: get("comments"),
    saves: get("saved"),
    shares: get("shares"),
    totalInteractions: get("total_interactions"),
    followerChange: mediaType === "FEED" ? get("follows") : null,
    profileActionsJson: hasProfile ? profile : null,
    videoMetricsJson: video && Object.values(video).some((v) => v !== null) ? video : null,
  };
}

// --- Cached availability -------------------------------------------------------------------------

/** `app_settings` key: which metrics are unsupported for which media type, learned from refusals. */
export const METRIC_AVAILABILITY_KEY = "instagram.metric_availability";
export type MetricAvailability = Partial<Record<InsightsMediaType, string[]>>;

export async function loadMetricAvailability(ctx: ServiceContext): Promise<MetricAvailability> {
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, METRIC_AVAILABILITY_KEY));
  const parsed = z
    .object({ FEED: z.array(z.string()).optional(), REELS: z.array(z.string()).optional() })
    .safeParse(row?.value);
  if (!parsed.success) return {};
  return {
    ...(parsed.data.FEED ? { FEED: parsed.data.FEED } : {}),
    ...(parsed.data.REELS ? { REELS: parsed.data.REELS } : {}),
  };
}

/** Remembers newly found unsupported metrics (added to what is known; never removed here). */
export async function rememberUnsupportedMetrics(
  ctx: ServiceContext,
  mediaType: InsightsMediaType,
  metrics: readonly string[],
): Promise<void> {
  if (metrics.length === 0) return;
  const known = await loadMetricAvailability(ctx);
  const merged = [...new Set([...(known[mediaType] ?? []), ...metrics])].sort();
  const value: MetricAvailability = { ...known, [mediaType]: merged };
  await ctx.db
    .insert(schema.appSettings)
    .values({ key: METRIC_AVAILABILITY_KEY, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}

// --- Account -------------------------------------------------------------------------------------

export type AccountInsights = {
  followersCount: number | null;
  reach: number | null;
  reachFollowers: number | null;
  reachNonFollowers: number | null;
  views: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
  follows: number | null;
  unfollows: number | null;
  /** Metrics a call could not give (an error that is not the whole call's failure), by name. */
  unavailable: string[];
  raw: Record<string, unknown>;
};

/**
 * One day's account insights as totals over `[since, until]` (Unix seconds): reach split into
 * followers and non-followers (`breakdown=follow_type`), views, accounts engaged, interactions,
 * follows and unfollows (needs 100 followers; the FOLLOWER share of the breakdown is read as the
 * follows and NON_FOLLOWER as the unfollows, which the docs do not spell out: V-11 to check live),
 * and the follower count now. Each call stands alone:
 * a metric Instagram refuses is null (and listed in `unavailable`); an error that is not about a
 * metric (token, rate limit, network) is thrown, so the caller can stop.
 */
export async function getAccountInsights(
  client: GraphClient,
  accountId: string,
  window: { since: number; until: number },
): Promise<AccountInsights> {
  const base = {
    period: "day",
    metric_type: "total_value",
    since: window.since,
    until: window.until,
  };
  const unavailable: string[] = [];
  const raw: Record<string, unknown> = {};

  const ask = async (label: string, params: Record<string, string | number>) => {
    try {
      const reply = await client.get(`/${accountId}/insights`, { ...base, ...params });
      raw[label] = reply;
      return Reply.parse(reply).data;
    } catch (error) {
      if (error instanceof InstagramCallError && isUnsupportedMetricError(error)) {
        unavailable.push(label);
        return [];
      }
      throw error;
    }
  };

  const reach = await ask("reach", { metric: "reach", breakdown: "follow_type" });
  const reachItem = reach.find((i) => i.name === "reach");
  const split = itemBreakdown(reachItem);
  const plain = await ask("plain", { metric: "views,accounts_engaged,total_interactions" });
  const byName = new Map(plain.map((i) => [i.name, i]));
  const follows = await ask("follows_and_unfollows", {
    metric: "follows_and_unfollows",
    breakdown: "follow_type",
  });
  const followSplit = itemBreakdown(follows.find((i) => i.name === "follows_and_unfollows"));

  let followersCount: number | null = null;
  try {
    const me = z
      .object({ followers_count: z.number().optional() })
      .passthrough()
      .parse(await client.get("/me", { fields: "followers_count" }));
    followersCount = me.followers_count ?? null;
    raw.followersCount = me;
  } catch (error) {
    if (!(error instanceof InstagramCallError) || !isUnsupportedMetricError(error)) throw error;
    unavailable.push("followers_count");
  }

  return {
    followersCount,
    reach: itemValue(reachItem),
    reachFollowers: split?.FOLLOWER ?? null,
    reachNonFollowers: split?.NON_FOLLOWER ?? null,
    views: itemValue(byName.get("views")),
    accountsEngaged: itemValue(byName.get("accounts_engaged")),
    totalInteractions: itemValue(byName.get("total_interactions")),
    follows: followSplit?.FOLLOWER === undefined ? null : (followSplit.FOLLOWER ?? null),
    unfollows: followSplit?.NON_FOLLOWER === undefined ? null : (followSplit.NON_FOLLOWER ?? null),
    unavailable,
    raw,
  };
}
