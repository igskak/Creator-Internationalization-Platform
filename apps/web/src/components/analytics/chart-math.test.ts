import { describe, expect, it } from "vitest";
import { compact, linePaths, nearestIndex, niceTicks, percent, rangeTicks } from "./chart-math";

describe("niceTicks", () => {
  it("rounds to clean numbers from zero up past the maximum", () => {
    expect(niceTicks(1284)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(95)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0.34, 4)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });
  it("still gives an axis for an empty or zero series", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
  });
});

describe("rangeTicks", () => {
  it("encloses the data without starting at zero", () => {
    expect(rangeTicks(1000, 1030, 3)).toEqual([1000, 1010, 1020, 1030]);
    expect(rangeTicks(987, 1043, 4)).toEqual([980, 1000, 1020, 1040, 1060]);
  });
  it("gives a small axis around a constant series", () => {
    expect(rangeTicks(500, 500)).toEqual([499, 500, 501]);
  });
});

describe("number formats", () => {
  it("compacts big numbers and keeps small ones whole", () => {
    expect(compact(1284, "en")).toBe("1,284");
    expect(compact(12_900, "en")).toBe("12.9K");
    expect(compact(4_200_000, "en")).toBe("4.2M");
  });
  it("writes a share as a percent of the viewer's locale", () => {
    expect(percent(0.0734, "en")).toBe("7.3%");
    expect(percent(0.5, "es-ES", 0).replace(/\s/g, " ")).toBe("50 %");
  });
});

describe("linePaths", () => {
  const x = (i: number) => i * 10;
  const y = (v: number) => 100 - v;
  it("draws one path for a full series", () => {
    expect(
      linePaths(
        [
          { date: "a", value: 10 },
          { date: "b", value: 20 },
        ],
        x,
        y,
      ),
    ).toEqual([{ d: "M0.0 90.0 L10.0 80.0", x0: 0, x1: 10 }]);
  });
  it("breaks the line at a missing value instead of drawing a zero", () => {
    const paths = linePaths(
      [
        { date: "a", value: 10 },
        { date: "b", value: null },
        { date: "c", value: 30 },
        { date: "d", value: 40 },
      ],
      x,
      y,
    );
    expect(paths).toEqual([
      { d: "M0.0 90.0", x0: 0, x1: 0 },
      { d: "M20.0 70.0 L30.0 60.0", x0: 20, x1: 30 },
    ]);
  });
  it("draws nothing for a series with no value", () => {
    expect(linePaths([{ date: "a", value: null }], x, y)).toEqual([]);
  });
});

describe("nearestIndex", () => {
  const x = (i: number) => i * 10;
  const points = [
    { date: "a", value: 1 },
    { date: "b", value: null },
    { date: "c", value: 3 },
  ];
  it("snaps to the nearest point that has a value", () => {
    expect(nearestIndex(points, 4, x)).toBe(0);
    expect(nearestIndex(points, 8, x)).toBe(0); // the point at 10 has no value, so 0 (8 away) wins over 20 (12 away)
    expect(nearestIndex(points, 16, x)).toBe(2);
  });
  it("is null when no point has a value", () => {
    expect(nearestIndex([{ date: "a", value: null }], 0, x)).toBeNull();
  });
});
