import { describe, expect, it } from "vitest";
import { type DraftsFilters, draftsHref, parseDraftsSearch } from "./drafts-query";

const base: DraftsFilters = { tab: "REVIEW", market: undefined, flagged: false, page: 1 };

describe("parseDraftsSearch", () => {
  it("defaults to the review tab, every market, all drafts, page 1", () => {
    expect(parseDraftsSearch({})).toEqual(base);
  });

  it("reads the tab, market, flag filter and page", () => {
    expect(
      parseDraftsSearch({ tab: "APPROVED", market: "es-ES", flagged: "1", page: "3" }),
    ).toEqual({ tab: "APPROVED", market: "es-ES", flagged: true, page: 3 });
  });

  it("ignores what it does not know", () => {
    expect(
      parseDraftsSearch({ tab: "NOPE", market: "<script>", flagged: "yes", page: "-2" }),
    ).toEqual(base);
    expect(parseDraftsSearch({ page: "2.5" }).page).toBe(1);
    expect(parseDraftsSearch({ tab: ["FAILED", "APPROVED"] }).tab).toBe("FAILED");
  });
});

describe("draftsHref", () => {
  it("leaves defaults out", () => {
    expect(draftsHref(base)).toBe("/content/drafts");
    expect(draftsHref(base, { tab: "FAILED" })).toBe("/content/drafts?tab=FAILED");
    expect(draftsHref(base, { market: "en", flagged: true })).toBe(
      "/content/drafts?market=en&flagged=1",
    );
  });

  it("goes back to page 1 when a filter changes, but keeps a page that was asked for", () => {
    const filters = { ...base, tab: "APPROVED" as const, page: 4 };
    expect(draftsHref(filters, { flagged: true })).toBe("/content/drafts?tab=APPROVED&flagged=1");
    expect(draftsHref(filters, { page: 5 })).toBe("/content/drafts?tab=APPROVED&page=5");
  });

  it("round-trips through parse", () => {
    const filters: DraftsFilters = { tab: "SCHEDULED", market: "es-ES", flagged: true, page: 2 };
    const url = new URL(`http://x${draftsHref(filters, { page: 2 })}`);
    expect(parseDraftsSearch(Object.fromEntries(url.searchParams))).toEqual(filters);
  });
});
