import { describe, expect, it } from "vitest";
import { ideasHref, parseIdeasSearch } from "./ideas-query";

describe("parseIdeasSearch", () => {
  it("defaults to the Proposed tab and page 1", () => {
    expect(parseIdeasSearch({})).toEqual({ status: "PROPOSED", page: 1 });
  });

  it("reads a known tab and a positive page", () => {
    expect(parseIdeasSearch({ status: "ACCEPTED", page: "3" })).toEqual({
      status: "ACCEPTED",
      page: 3,
    });
    expect(parseIdeasSearch({ status: ["REJECTED", "ARCHIVED"] })).toEqual({
      status: "REJECTED",
      page: 1,
    });
  });

  it("ignores an unknown tab and a malformed page", () => {
    expect(parseIdeasSearch({ status: "DELETED", page: "0" })).toEqual({
      status: "PROPOSED",
      page: 1,
    });
    expect(parseIdeasSearch({ page: "2.5" }).page).toBe(1);
    expect(parseIdeasSearch({ page: "abc" }).page).toBe(1);
    expect(parseIdeasSearch({ page: "-4" }).page).toBe(1);
  });
});

describe("ideasHref", () => {
  const current = { status: "PROPOSED", page: 2 } as const;

  it("leaves defaults out", () => {
    expect(ideasHref({ status: "PROPOSED", page: 1 })).toBe("/content/ideas");
  });

  it("keeps the tab and moves the page", () => {
    expect(ideasHref(current, { page: 3 })).toBe("/content/ideas?page=3");
    expect(ideasHref({ status: "ACCEPTED", page: 1 }, { page: 2 })).toBe(
      "/content/ideas?status=ACCEPTED&page=2",
    );
  });

  it("starts on page 1 when the tab changes", () => {
    expect(ideasHref(current, { status: "REJECTED" })).toBe("/content/ideas?status=REJECTED");
    expect(ideasHref(current, { status: "PROPOSED" })).toBe("/content/ideas?page=2");
  });
});
