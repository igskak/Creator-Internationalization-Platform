import { describe, expect, it } from "vitest";
import {
  DIRECTOR_COST_USD,
  estimateReel,
  TYPICAL_SHOT_COUNT,
  TYPICAL_SHOT_COUNT_V4,
} from "./estimate";

describe("estimateReel", () => {
  it("prices a typical Reel of the active director: 6 shots of 4 s, their pictures, the director", () => {
    const e = estimateReel();
    expect(e).toMatchObject({
      model: "alibaba/wan-3.0",
      resolution: "720p",
      shots: TYPICAL_SHOT_COUNT_V4,
      secondsPerShot: 4,
      directorUsd: DIRECTOR_COST_USD,
    });
    // Wan 3.0 at 720p lists at $0.10 a second: 6 × 4 s × 0.10; a picture about $0.05.
    expect(e.shotsUsd).toBeCloseTo(2.4, 4);
    expect(e.framesUsd).toBeCloseTo(0.3, 4);
    expect(e.totalUsd).toBeCloseTo(2.8, 4);
  });

  it("prices an older script (v3): 7 shots of 3 s and no pictures", () => {
    const e = estimateReel({ format: "v3" });
    expect(e).toMatchObject({ shots: TYPICAL_SHOT_COUNT, secondsPerShot: 3, framesUsd: 0 });
    expect(e.totalUsd).toBeCloseTo(2.2, 4);
  });

  it("uses the model's own rate and its minimum length", () => {
    const kling = estimateReel({ model: "kling-video/v3.0/std" });
    expect(kling.secondsPerShot).toBe(4);
    expect(kling.shotsUsd).toBeCloseTo(0.1071 * 4 * 6, 3);
    expect(estimateReel({ model: "kling-video/v3.0/std", format: "v3" }).secondsPerShot).toBe(3);
    const seedance = estimateReel({ model: "bytedance/seedance-2.0" });
    expect(seedance.secondsPerShot).toBe(4);
    expect(seedance.totalUsd).toBeGreaterThan(kling.totalUsd);
  });

  it("scales with the number of shots, the pictures and the resolution", () => {
    expect(estimateReel({ shots: 5 }).shotsUsd).toBeCloseTo(2, 4);
    expect(estimateReel({ shots: 1, frames: 0 }).totalUsd).toBeCloseTo(0.5, 4);
    expect(estimateReel({ resolution: "480p" }).shotsUsd).toBeCloseTo(6 * 4 * 0.05, 4);
    expect(estimateReel({ shots: 0 }).totalUsd).toBe(DIRECTOR_COST_USD);
  });
});
