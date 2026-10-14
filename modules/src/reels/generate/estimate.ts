import {
  DEFAULT_RATES,
  DEFAULT_VIDEO_MODEL,
  estimateShotCostUsd,
  type Rates,
  type VideoModelId,
  type VideoResolution,
} from "@rc/lib/providers/video";
import { SHOT_RESOLUTION, shotSecondsFor } from "./shots";

// What a Reel will cost before anything is spent (plan 18 §18.7, decision RL-4: an estimate with
// no hard cap). shots × seconds × the model's rate, plus the director call. List prices: an
// upper bound; the real cost is recorded per shot afterwards.

/** One call of reel-director@1 (live run of 2026-10-14: $0.08 to $0.15). */
export const DIRECTOR_COST_USD = 0.1;
/** Scenes of a typical script (the director is asked for 6 to 9). */
export const TYPICAL_SHOT_COUNT = 7;

export type ReelEstimate = {
  model: VideoModelId;
  resolution: VideoResolution;
  shots: number;
  secondsPerShot: number;
  shotsUsd: number;
  directorUsd: number;
  totalUsd: number;
};

const round = (x: number) => Math.round(x * 10_000) / 10_000;

export function estimateReel(
  options: {
    model?: VideoModelId;
    resolution?: VideoResolution;
    shots?: number;
    rates?: Rates;
  } = {},
): ReelEstimate {
  const model = options.model ?? DEFAULT_VIDEO_MODEL;
  const resolution = options.resolution ?? SHOT_RESOLUTION;
  const shots = options.shots ?? TYPICAL_SHOT_COUNT;
  const secondsPerShot = shotSecondsFor(model);
  const perShot = estimateShotCostUsd(
    model,
    secondsPerShot,
    resolution,
    options.rates ?? DEFAULT_RATES,
  );
  const shotsUsd = round(perShot * shots);
  return {
    model,
    resolution,
    shots,
    secondsPerShot,
    shotsUsd,
    directorUsd: DIRECTOR_COST_USD,
    totalUsd: round(shotsUsd + DIRECTOR_COST_USD),
  };
}
