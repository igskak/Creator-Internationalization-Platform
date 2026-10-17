import { describe, expect, it } from "vitest";
import { pageLevelOf } from "./page-level";

const frame = (width: number, height: number, page: number) => {
  const data = new Uint8Array(width * height * 3).fill(page);
  return { data, width, height, channels: 3 };
};

describe("pageLevelOf", () => {
  it("reads the grey of the page from the outer ring", () => {
    expect(pageLevelOf(frame(100, 180, 230))).toBeCloseTo(230 / 255, 3);
    expect(pageLevelOf(frame(100, 180, 255))).toBe(1);
  });

  it("ignores a dark subject in the middle and on the edge, and takes the darker light pixels", () => {
    const f = frame(100, 180, 240);
    // A dark subject bleeding off the right edge, and a lighter corner (a vignette the other way).
    for (let y = 60; y < 120; y++)
      for (let x = 50; x < 100; x++) f.data.fill(60, (y * 100 + x) * 3, (y * 100 + x) * 3 + 3);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) f.data.fill(252, (y * 100 + x) * 3, (y * 100 + x) * 3 + 3);
    expect(pageLevelOf(f)).toBeCloseTo(240 / 255, 3);
  });

  it("says white when no light pixel is on the ring", () => {
    expect(pageLevelOf(frame(40, 40, 90))).toBe(1);
  });
});
