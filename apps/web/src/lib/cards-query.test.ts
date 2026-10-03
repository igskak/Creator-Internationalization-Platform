import { describe, expect, it } from "vitest";
import {
  CARD_FLAG_VALUES,
  CARD_STATUS_VALUES,
  type CardsFilters,
  cardsHref,
  clearedFilters,
  hasActiveFilters,
  parseCardsSearch,
  toggled,
  toListInput,
} from "./cards-query";

const SOURCE = "123e4567-e89b-42d3-a456-426614174000";
const base: CardsFilters = {
  status: "NEEDS_REVIEW",
  categories: [],
  flags: [],
  sources: [],
  language: undefined,
  q: "",
  page: 1,
};

describe("parseCardsSearch", () => {
  it("defaults to the cards that need review and the first page", () => {
    expect(parseCardsSearch({})).toEqual(base);
  });

  it("reads status, repeated filters, language, search and page", () => {
    expect(
      parseCardsSearch({
        status: "CHEF_APPROVED",
        category: ["MEAT", "EGGS"],
        flag: "SAFETY_SENSITIVE",
        source: SOURCE,
        language: "ru",
        q: "  гречка ",
        page: "3",
      }),
    ).toEqual({
      status: "CHEF_APPROVED",
      categories: ["MEAT", "EGGS"],
      flags: ["SAFETY_SENSITIVE"],
      sources: [SOURCE],
      language: "ru",
      q: "гречка",
      page: 3,
    });
    expect(parseCardsSearch({ status: "all" }).status).toBe("all");
  });

  it("ignores values that are unknown or malformed instead of failing", () => {
    expect(
      parseCardsSearch({
        status: "DELETED",
        category: ["meat", "'; drop table", "MEAT", "MEAT"],
        flag: ["NOPE", "LOW_CONFIDENCE"],
        source: ["not-a-uuid", SOURCE],
        language: "russian",
        page: ["0", "5"],
      }),
    ).toEqual({ ...base, categories: ["MEAT"], flags: ["LOW_CONFIDENCE"], sources: [SOURCE] });
    expect(parseCardsSearch({ page: "2.5" }).page).toBe(1);
    expect(parseCardsSearch({ page: "-4" }).page).toBe(1);
    expect(parseCardsSearch({ q: "x".repeat(500) }).q).toHaveLength(200);
    expect(parseCardsSearch({ category: "" }).categories).toEqual([]);
  });

  it("knows the same statuses and flags as the service", async () => {
    const { CARD_FLAGS, CARD_STATUSES } = await import("@rc/modules/knowledge");
    expect([...CARD_STATUS_VALUES].sort()).toEqual([...CARD_STATUSES].sort());
    expect([...CARD_FLAG_VALUES].sort()).toEqual([...CARD_FLAGS].sort());
  });
});

describe("toListInput", () => {
  it("turns filters into the service input and leaves out what is not set", () => {
    expect(toListInput(base)).toEqual({ statuses: ["NEEDS_REVIEW"], page: 1 });
    expect(toListInput({ ...base, status: "all" })).toEqual({ page: 1 });
    expect(
      toListInput({
        ...base,
        status: "ARCHIVED",
        categories: ["MEAT"],
        flags: ["LOW_CONFIDENCE"],
        sources: [SOURCE],
        language: "es",
        q: "sal",
        page: 2,
      }),
    ).toEqual({
      statuses: ["ARCHIVED"],
      categories: ["MEAT"],
      flags: ["LOW_CONFIDENCE"],
      sourceIds: [SOURCE],
      language: "es",
      q: "sal",
      page: 2,
    });
  });
});

describe("cardsHref", () => {
  it("is the bare path for the default view and drops defaults from the query", () => {
    expect(cardsHref(base)).toBe("/knowledge/cards");
    expect(cardsHref(base, { status: "all" })).toBe("/knowledge/cards?status=all");
    expect(cardsHref(base, { status: "NEEDS_REVIEW" })).toBe("/knowledge/cards");
  });

  it("writes every filter and round-trips through the parser", () => {
    const filters: CardsFilters = {
      status: "CHEF_APPROVED",
      categories: ["MEAT", "FOOD_SCIENCE"],
      flags: ["SAFETY_SENSITIVE", "LOW_CONFIDENCE"],
      sources: [SOURCE],
      language: "ru",
      q: "гречка & рис",
      page: 4,
    };
    const href = cardsHref(filters, { page: 4 });
    expect(href).toContain("category=MEAT&category=FOOD_SCIENCE");
    const query = Object.fromEntries(
      [...new Set([...new URL(href, "http://x").searchParams.keys()])].map((key) => {
        const values = new URL(href, "http://x").searchParams.getAll(key);
        return [key, values.length > 1 ? values : values[0]];
      }),
    );
    expect(parseCardsSearch(query)).toEqual(filters);
  });

  it("goes back to page 1 when a filter changes, but keeps a page that is set on purpose", () => {
    const onPage3 = { ...base, page: 3 };
    expect(cardsHref(onPage3, { categories: ["MEAT"] })).toBe("/knowledge/cards?category=MEAT");
    expect(cardsHref(onPage3, { page: 4 })).toBe("/knowledge/cards?page=4");
  });
});

describe("filter helpers", () => {
  it("toggles values", () => {
    expect(toggled(["a"], "b")).toEqual(["a", "b"]);
    expect(toggled(["a", "b"], "a")).toEqual(["b"]);
  });

  it("detects active filters apart from the status and clears them", () => {
    expect(hasActiveFilters(base)).toBe(false);
    expect(hasActiveFilters({ ...base, status: "ARCHIVED" })).toBe(false);
    expect(hasActiveFilters({ ...base, q: "x" })).toBe(true);
    expect(hasActiveFilters({ ...base, language: "ru" })).toBe(true);
    const busy: CardsFilters = {
      ...base,
      status: "ARCHIVED",
      categories: ["MEAT"],
      flags: ["LOW_CONFIDENCE"],
      sources: [SOURCE],
      language: "ru",
      q: "x",
      page: 3,
    };
    expect(clearedFilters(busy)).toEqual({ ...base, status: "ARCHIVED" });
  });
});
