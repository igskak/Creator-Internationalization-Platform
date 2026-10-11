import { describe, expect, it } from "vitest";
import {
  addDays,
  calendarHref,
  clock,
  mondayOf,
  parseCalendarSearch,
  weekRange,
} from "./calendar-query";

describe("calendar address", () => {
  it("reads the view, week and zone and ignores nonsense", () => {
    expect(parseCalendarSearch({})).toEqual({ view: "week", week: undefined, zone: undefined });
    expect(parseCalendarSearch({ view: "list", week: "2026-10-19", zone: "es-ES" })).toEqual({
      view: "list",
      week: "2026-10-19",
      zone: "es-ES",
    });
    expect(parseCalendarSearch({ view: "grid", week: "2026-02-30", zone: "<x>" })).toEqual({
      view: "week",
      week: undefined,
      zone: undefined,
    });
  });

  it("leaves defaults out of the address", () => {
    const base = parseCalendarSearch({});
    expect(calendarHref(base)).toBe("/content/calendar");
    expect(calendarHref(base, { view: "list", week: "2026-10-19", zone: "en" })).toBe(
      "/content/calendar?view=list&week=2026-10-19&zone=en",
    );
  });
});

describe("weeks", () => {
  it("moves dates by days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds Monday", () => {
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-10-21")).toBe("2026-10-19");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });

  it("draws this week from now in the zone of the grid", () => {
    // 2026-10-21 00:30 in Madrid is still the 20th in UTC.
    const range = weekRange({ week: undefined }, new Date("2026-10-20T22:30:00Z"), "Europe/Madrid");
    expect(range.monday).toBe("2026-10-19");
    expect(range.days[0]).toBe("2026-10-19");
    expect(range.days[6]).toBe("2026-10-25");
    expect(range.from.toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-10-25T23:00:00.000Z"); // clocks go back on the 25th
  });

  it("uses the week in the address", () => {
    const range = weekRange({ week: "2026-11-04" }, new Date("2026-10-10T00:00:00Z"), "UTC");
    expect(range.monday).toBe("2026-11-02");
    expect(range.to.getTime() - range.from.getTime()).toBe(7 * 86_400_000);
  });

  it("a week with a clock change is not 168 hours", () => {
    const range = weekRange({ week: "2026-03-23" }, new Date(), "Europe/Madrid");
    expect((range.to.getTime() - range.from.getTime()) / 3_600_000).toBe(167);
  });

  it("writes a time of day in a zone", () => {
    expect(clock(new Date("2026-10-20T11:05:00Z"), "Europe/Madrid")).toBe("13:05");
    expect(clock(new Date("2026-10-20T11:05:00Z"), "America/New_York")).toBe("07:05");
  });
});
