// URL state of the draft queue (/content/drafts): the tab, the market, the flag filter and the
// page live in the address. Plain functions, no framework imports: the server page and its links
// share them.

export const DRAFT_TABS = [
  "REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHED",
  "FAILED",
  "REJECTED",
] as const;
export type DraftTabValue = (typeof DRAFT_TABS)[number];
export const DEFAULT_DRAFT_TAB: DraftTabValue = "REVIEW";

export type DraftsFilters = {
  tab: DraftTabValue;
  /** `markets.code`. */
  market: string | undefined;
  flagged: boolean;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value) || undefined;

/** Reads the address; anything unknown or malformed falls back to the default. */
export function parseDraftsSearch(params: Params): DraftsFilters {
  const tab = first(params.tab);
  const market = first(params.market);
  const page = Number(first(params.page));
  return {
    tab: (DRAFT_TABS as readonly string[]).includes(tab ?? "")
      ? (tab as DraftTabValue)
      : DEFAULT_DRAFT_TAB,
    market: market && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(market) ? market : undefined,
    flagged: first(params.flagged) === "1",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The queue address for some filters; defaults are left out. Changing a filter restarts at page 1. */
export function draftsHref(filters: DraftsFilters, change: Partial<DraftsFilters> = {}): string {
  const next = { ...filters, ...change };
  const page = "page" in change ? next.page : 1;
  const query = new URLSearchParams();
  if (next.tab !== DEFAULT_DRAFT_TAB) query.set("tab", next.tab);
  if (next.market) query.set("market", next.market);
  if (next.flagged) query.set("flagged", "1");
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `/content/drafts?${text}` : "/content/drafts";
}
