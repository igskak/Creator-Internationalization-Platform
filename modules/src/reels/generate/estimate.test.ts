import { describe, expect, it } from "vitest";
import { DIRECTOR_COST_USD, estimateReel, TYPICAL_SHOT_COUNT } from "./estimate";

describe("estimateReel", () => {
  it("prices a typical Reel on the default model: 7 shots of 3 s at 720p plus the director", () => {
    const e = estimateReel();
    expect(e).toMatchObject({
      model: "alibaba/wan-3.0",
      resolution: "720p",
      shots: TYPICAL_SHOT_COUNT,
      secondsPerShot: 3,
      directorUsd: DIRECTOR_COST_USD,
    });
    // Wan 3.0 at 720p lists at $0.10 a second: 7 × 3 s × 0.10.
    expect(e.shotsUsd).toBeCloseTo(2.1, 4);
    expect(e.totalUsd).toBeCloseTo(2.2, 4);
  });

  it("uses the model's own rate and its minimum length", () => {
    const kling = estimateReel({ model: "kling-video/v3.0/std" });
    expect(kling.secondsPerShot).toBe(3);
    expect(kling.shotsUsd).toBeCloseTo(0.1071 * 3 * 7, 3);
    const seedance = estimateReel({ model: "bytedance/seedance-2.0" });
    expect(seedance.secondsPerShot).toBe(4);
    expect(seedance.totalUsd).toBeGreaterThan(kling.totalUsd);
  });

  it("scales with the number of shots and the resolution", () => {
    expect(estimateReel({ shots: 6 }).shotsUsd).toBeCloseTo(1.8, 4);
    expect(estimateReel({ resolution: "480p" }).shotsUsd).toBeCloseTo(7 * 3 * 0.05, 4);
    expect(estimateReel({ shots: 0 }).totalUsd).toBe(DIRECTOR_COST_USD);
  });
});
