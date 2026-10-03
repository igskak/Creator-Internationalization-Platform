// URL state of the Knowledge Base list (/knowledge/cards): the filters live in the query string,
// so a view can be bookmarked or shared and the server renders exactly what the address says.
// Plain functions, no framework imports: the server page and the client filter menus share them.

export const CARD_STATUS_VALUES = [
  "NEEDS_REVIEW",
  "CHEF_APPROVED",
  "ARCHIVED",
  "EXTRACTED",
] as const;
export type CardStatusValue = (typeof CARD_STATUS_VALUES)[number];
export const CARD_FLAG_VALUES = [
  "QUOTE_UNVERIFIED",
  "LOW_CONFIDENCE",
  "DUPLICATE_SUSPECTED",
  "SAFETY_SENSITIVE",
] as const;
export type CardFlagValue = (typeof CARD_FLAG_VALUES)[number];

export const DEFAULT_STATUS: CardStatusValue = "NEEDS_REVIEW";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CardsFilters = {
  /** `all` shows every status. */
  status: CardStatusValue | "all";
  categories: string[];
  flags: CardFlagValue[];
  sources: string[];
  language: string | undefined;
  q: string;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;
const many = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter((v) => v !== "");
const first = (value: string | string[] | undefined): string | undefined => many(value)[0];
const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** Reads the address; anything unknown or malformed is ignored rather than turned into an error. */
export function parseCardsSearch(params: Params): CardsFilters {
  const status = first(params.status);
  const page = Number(first(params.page));
  const language = first(params.language);
  return {
    status:
      status === "all"
        ? "all"
        : (CARD_STATUS_VALUES as readonly string[]).includes(status ?? "")
          ? (status as CardStatusValue)
          : DEFAULT_STATUS,
    categories: unique(many(params.category).filter((c) => /^[A-Z0-9_]{1,64}$/.test(c))),
    flags: unique(
      many(params.flag).filter((f): f is CardFlagValue =>
        (CARD_FLAG_VALUES as readonly string[]).includes(f),
      ),
    ),
    sources: unique(many(params.source).filter((s) => UUID.test(s))),
    language: language && /^[a-z]{2}$/.test(language) ? language : undefined,
    q: (first(params.q) ?? "").trim().slice(0, 200),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The input of `listKnowledgeCards` for these filters. */
export function toListInput(filters: CardsFilters) {
  return {
    ...(filters.status === "all" ? {} : { statuses: [filters.status] }),
    ...(filters.categories.length ? { categories: filters.categories } : {}),
    ...(filters.flags.length ? { flags: filters.flags } : {}),
    ...(filters.sources.length ? { sourceIds: filters.sources } : {}),
    ...(filters.language ? { language: filters.language } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    page: filters.page,
  };
}

/**
 * The address for `filters` with `patch` applied. Values that equal the default are left out, and
 * the page goes back to 1 whenever a filter changes (unless the patch sets the page itself).
 */
export function cardsHref(filters: CardsFilters, patch: Partial<CardsFilters> = {}): string {
  const next: CardsFilters = { ...filters, ...patch };
  if (patch.page === undefined) next.page = 1;
  const query = new URLSearchParams();
  if (next.status !== DEFAULT_STATUS) query.set("status", next.status);
  for (const c of next.categories) query.append("category", c);
  for (const f of next.flags) query.append("flag", f);
  for (const s of next.sources) query.append("source", s);
  if (next.language) query.set("language", next.language);
  if (next.q) query.set("q", next.q);
  if (next.page > 1) query.set("page", String(next.page));
  const text = query.toString();
  return text ? `/knowledge/cards?${text}` : "/knowledge/cards";
}

/** True when anything other than the status narrows the list (the "Clear filters" case). */
export const hasActiveFilters = (f: CardsFilters): boolean =>
  f.categories.length > 0 ||
  f.flags.length > 0 ||
  f.sources.length > 0 ||
  f.language !== undefined ||
  f.q !== "";

/** Clears every filter and the search but keeps the status tab. */
export const clearedFilters = (f: CardsFilters): CardsFilters => ({
  ...f,
  categories: [],
  flags: [],
  sources: [],
  language: undefined,
  q: "",
  page: 1,
});

/** Adds the value when it is missing and removes it when it is there. */
export const toggled = <T>(values: T[], value: T): T[] =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
