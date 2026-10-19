import {
  DEFAULT_RATES,
  DEFAULT_VIDEO_MODEL,
  estimateShotCostUsd,
  type Rates,
  type VideoModelId,
  type VideoResolution,
} from "@rc/lib/providers/video";
import { STAGE_CONFIG } from "../../ai";
import { type ReelScriptFormat, reelScriptFormat } from "../director";
import { REEL_FRAME_COST_USD } from "./frames";
import { SHOT_RESOLUTION, SHOT_SECONDS_V4, shotSecondsFor } from "./shots";

// What a Reel will cost before anything is spent (plan 18 §18.7, decision RL-4: an estimate with
// no hard cap). shots × seconds × the model's rate, plus the director call, plus (reel-director@4)
// one picture per shot. List prices: an upper bound; the real cost is recorded afterwards.

/** One call of reel-director@1 (live run of 2026-10-14: $0.08 to $0.15). */
export const DIRECTOR_COST_USD = 0.1;
/** Scenes of a typical script (the director is asked for 6 to 9). */
export const TYPICAL_SHOT_COUNT = 7;
/** Scenes of a typical reel-director@4 script (5 to 7, usually 6). */
export const TYPICAL_SHOT_COUNT_V4 = 6;

export type ReelEstimate = {
  model: VideoModelId;
  resolution: VideoResolution;
  shots: number;
  secondsPerShot: number;
  shotsUsd: number;
  /** The pictures made for the shots (reel-director@4); 0 before. */
  framesUsd: number;
  directorUsd: number;
  totalUsd: number;
};

const round = (x: number) => Math.round(x * 10_000) / 10_000;

/** The format the active director writes: what a new Reel will be. */
export const activeReelFormat = (): ReelScriptFormat =>
  reelScriptFormat(STAGE_CONFIG.REEL_DIRECTION.version);

/** Whole seconds a shot lasts with this model in this format. */
export const shotSecondsOf = (model: VideoModelId, format: ReelScriptFormat): number =>
  Math.max(format === "v4" ? SHOT_SECONDS_V4 : 0, shotSecondsFor(model));

export function estimateReel(
  options: {
    model?: VideoModelId;
    resolution?: VideoResolution;
    shots?: number;
    rates?: Rates;
    /** Default: the format of the active director. */
    format?: ReelScriptFormat;
    /** Pictures to make; default one per shot in v4, none before. */
    frames?: number;
  } = {},
): ReelEstimate {
  const model = options.model ?? DEFAULT_VIDEO_MODEL;
  const format = options.format ?? activeReelFormat();
  const resolution = options.resolution ?? SHOT_RESOLUTION;
  const shots = options.shots ?? (format === "v4" ? TYPICAL_SHOT_COUNT_V4 : TYPICAL_SHOT_COUNT);
  const secondsPerShot = shotSecondsOf(model, format);
  const perShot = estimateShotCostUsd(
    model,
    secondsPerShot,
    resolution,
    options.rates ?? DEFAULT_RATES,
  );
  const shotsUsd = round(perShot * shots);
  const frames = format === "v4" ? (options.frames ?? shots) : 0;
  const framesUsd = round(frames * REEL_FRAME_COST_USD);
  return {
    model,
    resolution,
    shots,
    secondsPerShot,
    shotsUsd,
    framesUsd,
    directorUsd: DIRECTOR_COST_USD,
    totalUsd: round(shotsUsd + framesUsd + DIRECTOR_COST_USD),
  };
}
