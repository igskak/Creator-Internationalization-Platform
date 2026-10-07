// URL state of the ideas list (/content/ideas): the tab and the page live in the address.
// Plain functions, no framework imports: the server page and its links share them.

export const IDEA_TABS = ["PROPOSED", "ACCEPTED", "REJECTED", "ARCHIVED"] as const;
export type IdeaTab = (typeof IDEA_TABS)[number];
export const DEFAULT_IDEA_TAB: IdeaTab = "PROPOSED";

export type IdeasFilters = { status: IdeaTab; page: number };

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value) || undefined;

/** Reads the address; anything unknown or malformed falls back to the first tab and page 1. */
export function parseIdeasSearch(params: Params): IdeasFilters {
  const status = first(params.status);
  const page = Number(first(params.page));
  return {
    status: (IDEA_TABS as readonly string[]).includes(status ?? "")
      ? (status as IdeaTab)
      : DEFAULT_IDEA_TAB,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The list address for a tab and page; defaults are left out so the address stays short. */
export function ideasHref(filters: IdeasFilters, change: Partial<IdeasFilters> = {}): string {
  const next = { ...filters, ...change };
  // Another tab starts on its first page.
  const page = change.status && change.status !== filters.status ? (change.page ?? 1) : next.page;
  const query = new URLSearchParams();
  if (next.status !== DEFAULT_IDEA_TAB) query.set("status", next.status);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `/content/ideas?${text}` : "/content/ideas";
}
