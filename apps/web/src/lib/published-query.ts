// URL state of /content/published: the market, the format and the page live in the address.

export const PUBLISHED_FORMATS = ["CAROUSEL", "REEL"] as const;
export type PublishedFormat = (typeof PUBLISHED_FORMATS)[number];

export type PublishedFilters = {
  /** `markets.code`. */
  market: string | undefined;
  format: PublishedFormat | undefined;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value) || undefined;

export function parsePublishedSearch(params: Params): PublishedFilters {
  const market = first(params.market);
  const format = first(params.format);
  const page = Number(first(params.page));
  return {
    market: market && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(market) ? market : undefined,
    format: (PUBLISHED_FORMATS as readonly string[]).includes(format ?? "")
      ? (format as PublishedFormat)
      : undefined,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The list address for some filters; defaults are left out, a changed filter restarts at page 1. */
export function publishedHref(
  filters: PublishedFilters,
  change: Partial<PublishedFilters> = {},
  base = "/content/published",
): string {
  const next = { ...filters, ...change };
  const page = "page" in change ? next.page : 1;
  const query = new URLSearchParams();
  if (next.market) query.set("market", next.market);
  if (next.format) query.set("format", next.format);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}
