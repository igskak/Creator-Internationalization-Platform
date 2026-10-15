// URL state of /analytics: the tab, the market, the window and the dimension of the learning tab.

export const ANALYTICS_TABS = [
  "growth",
  "engagement",
  "learning",
  "commercial",
  "operations",
  "summary",
] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];
export const RANGES = ["7", "28", "90"] as const;
export type RangeDays = (typeof RANGES)[number];

export type AnalyticsFilters = {
  tab: AnalyticsTab;
  /** `markets.code`, or undefined for all markets. */
  market: string | undefined;
  range: RangeDays;
  dimension: string;
};

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseAnalyticsSearch(
  params: Params,
  validDimensions: readonly string[],
): AnalyticsFilters {
  const tab = first(params.tab);
  const range = first(params.range);
  const dimension = first(params.dimension);
  return {
    tab: (ANALYTICS_TABS as readonly string[]).includes(tab ?? "")
      ? (tab as AnalyticsTab)
      : "growth",
    market: first(params.market) || undefined,
    range: (RANGES as readonly string[]).includes(range ?? "") ? (range as RangeDays) : "28",
    dimension: validDimensions.includes(dimension ?? "") ? (dimension as string) : "hook_type",
  };
}

export function analyticsHref(
  filters: AnalyticsFilters,
  change: Partial<AnalyticsFilters> = {},
): string {
  const f = { ...filters, ...change };
  const q = new URLSearchParams({ tab: f.tab, range: f.range });
  if (f.market) q.set("market", f.market);
  if (f.tab === "learning") q.set("dimension", f.dimension);
  return `/analytics?${q.toString()}`;
}

/** The window of N days ending with today (UTC): `to` is the start of tomorrow, exclusive. */
export function windowOf(now: Date, range: RangeDays): { from: string; to: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - Number(range) * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
