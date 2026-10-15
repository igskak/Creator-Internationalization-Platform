import { describe, expect, it } from "vitest";
import { parsePublishedSearch, publishedHref } from "./published-query";

describe("published list address", () => {
  it("reads the market, the format and the page, and ignores what is malformed", () => {
    expect(parsePublishedSearch({ market: "es-ES", format: "REEL", page: "3" })).toEqual({
      market: "es-ES",
      format: "REEL",
      page: 3,
    });
    expect(parsePublishedSearch({ market: "x; drop", format: "PDF", page: "-2" })).toEqual({
      market: undefined,
      format: undefined,
      page: 1,
    });
    expect(parsePublishedSearch({})).toEqual({ market: undefined, format: undefined, page: 1 });
  });

  it("writes the address without defaults, and restarts at page 1 when a filter changes", () => {
    const f = { market: "en", format: undefined, page: 4 };
    expect(publishedHref({ market: undefined, format: undefined, page: 1 })).toBe(
      "/content/published",
    );
    expect(publishedHref(f, { page: 5 })).toBe("/content/published?market=en&page=5");
    expect(publishedHref(f, { format: "REEL" })).toBe("/content/published?market=en&format=REEL");
    expect(publishedHref(f, {}, "/content/published/export")).toBe(
      "/content/published/export?market=en",
    );
  });
});
