import { describe, expect, it } from "vitest";
import {
  formatLocalDateTime,
  localDate,
  localParts,
  offsetLabel,
  parseLocalDateTime,
  zonedToUtc,
  zoneOffsetMinutes,
} from "./time";

const local = (text: string) =>
  parseLocalDateTime(text) as NonNullable<ReturnType<typeof parseLocalDateTime>>;

describe("zone offsets", () => {
  it("knows Madrid's summer and winter time and New York's", () => {
    expect(zoneOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "Europe/Madrid")).toBe(120);
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "Europe/Madrid")).toBe(60);
    expect(zoneOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "UTC")).toBe(0);
  });

  it("labels them", () => {
    expect(offsetLabel(new Date("2026-07-01T12:00:00Z"), "Europe/Madrid")).toBe("UTC+2");
    expect(offsetLabel(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe("UTC-5");
    expect(offsetLabel(new Date("2026-01-15T12:00:00Z"), "Asia/Kolkata")).toBe("UTC+5:30");
  });
});

describe("parseLocalDateTime", () => {
  it("accepts the datetime-local shape and refuses impossible dates", () => {
    expect(parseLocalDateTime("2026-10-20T13:05")).toEqual({
      year: 2026,
      month: 10,
      day: 20,
      hour: 13,
      minute: 5,
    });
    expect(parseLocalDateTime("2026-10-20 13:05")).not.toBeNull();
    for (const bad of [
      "2026-02-30T10:00",
      "2026-13-01T10:00",
      "2026-10-20T24:00",
      "2026-10-20",
      "x",
    ]) {
      expect(parseLocalDateTime(bad)).toBeNull();
    }
  });
});

describe("zonedToUtc", () => {
  it("converts a wall-clock time of the market to UTC", () => {
    expect(zonedToUtc(local("2026-10-20T13:00"), "Europe/Madrid")).toEqual({
      utc: new Date("2026-10-20T11:00:00Z"),
      adjusted: false,
    });
    expect(zonedToUtc(local("2026-12-01T13:00"), "Europe/Madrid").utc.toISOString()).toBe(
      "2026-12-01T12:00:00.000Z",
    );
    expect(zonedToUtc(local("2026-07-01T09:30"), "America/New_York").utc.toISOString()).toBe(
      "2026-07-01T13:30:00.000Z",
    );
    expect(zonedToUtc(local("2026-07-01T09:30"), "UTC").utc.toISOString()).toBe(
      "2026-07-01T09:30:00.000Z",
    );
  });

  it("moves a time that does not exist (clocks go forward) and says so", () => {
    // Madrid, 2026-03-29: 02:00 → 03:00. 02:30 does not exist.
    const result = zonedToUtc(local("2026-03-29T02:30"), "Europe/Madrid");
    expect(result.adjusted).toBe(true);
    expect(localParts(result.utc, "Europe/Madrid")).toMatchObject({ hour: 3, minute: 30 });
    // The hours around it are fine.
    expect(zonedToUtc(local("2026-03-29T01:30"), "Europe/Madrid").adjusted).toBe(false);
    expect(zonedToUtc(local("2026-03-29T03:30"), "Europe/Madrid").adjusted).toBe(false);
  });

  it("takes the first of the two when a time happens twice (clocks go back)", () => {
    // Madrid, 2026-10-25: 03:00 → 02:00. 02:30 happens at 00:30Z and again at 01:30Z.
    const result = zonedToUtc(local("2026-10-25T02:30"), "Europe/Madrid");
    expect(result.utc.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(result.adjusted).toBe(false);
    expect(zonedToUtc(local("2026-10-25T03:30"), "Europe/Madrid").utc.toISOString()).toBe(
      "2026-10-25T02:30:00.000Z",
    );
  });

  it("round-trips through the wall clock for the days around a change", () => {
    for (const tz of ["Europe/Madrid", "America/New_York", "Australia/Sydney"]) {
      for (let day = 0; day < 20; day++) {
        const base = new Date(Date.UTC(2026, 2, 20 + day, 12));
        const text = formatLocalDateTime(base, tz);
        const back = zonedToUtc(local(text), tz);
        expect(back.adjusted).toBe(false);
        expect(formatLocalDateTime(back.utc, tz)).toBe(text);
      }
    }
  });
});

describe("wall clock of a zone", () => {
  it("gives the date, parts and weekday in the zone, not in UTC", () => {
    const instant = new Date("2026-10-20T22:30:00Z"); // 00:30 on the 21st in Madrid
    expect(localParts(instant, "Europe/Madrid")).toMatchObject({ day: 21, hour: 0, minute: 30 });
    expect(localDate(instant, "Europe/Madrid")).toBe("2026-10-21");
    expect(localDate(instant, "America/New_York")).toBe("2026-10-20");
    expect(formatLocalDateTime(instant, "Europe/Madrid")).toBe("2026-10-21T00:30");
    // 2026-10-21 is a Wednesday: Monday = 0.
    expect(localParts(instant, "Europe/Madrid").weekday).toBe(2);
  });
});
