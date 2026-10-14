import type { VideoModelId, VideoResolution } from "./types";

// List prices of the Higgsfield API read on 2026-10-13 from open.higgsfield.ai (before any
// customer discount, so an estimate is an upper bound; promotions of 15-60 % came and went).
// Measured against the owner's billing for a 5 s 720p clip: Kling 3.0 Std about 0.54 USD (rate
// 0.1071 USD per second), Seedance 2.0 about 1.10 USD (list 1.51 USD, 30 % off).

export type Rates = {
  /** Wan 3.0: USD per second by resolution. */
  wan: Record<VideoResolution, number>;
  /** Kling 3.0 Std image-to-video: USD per second for clips of 3 to 15 s. */
  klingPerSecond: number;
  /** Seedance 2.0: USD per 1,000 video tokens (480p/720p/1080p). */
  seedancePerThousandTokens: number;
};

export const DEFAULT_RATES: Rates = {
  wan: { "480p": 0.05, "720p": 0.1, "1080p": 0.2 },
  klingPerSecond: 0.1071,
  seedancePerThousandTokens: 0.014,
};

/** Output size of a 9:16 clip by resolution. */
export const PORTRAIT_SIZES: Record<VideoResolution, { width: number; height: number }> = {
  "480p": { width: 480, height: 854 },
  "720p": { width: 720, height: 1280 },
  "1080p": { width: 1080, height: 1920 },
};

/** Allowed whole seconds per model (the API refuses others). */
export function shotDurationRange(model: VideoModelId): { min: number; max: number } {
  switch (model) {
    case "alibaba/wan-3.0":
      return { min: 2, max: 15 };
    case "kling-video/v3.0/std":
      return { min: 3, max: 15 };
    case "bytedance/seedance-2.0":
      return { min: 4, max: 15 };
  }
}

/** Estimated list-price USD of one shot, rounded to 4 decimals. */
export function estimateShotCostUsd(
  model: VideoModelId,
  durationSeconds: number,
  resolution: VideoResolution = "720p",
  rates: Rates = DEFAULT_RATES,
): number {
  let usd: number;
  switch (model) {
    case "alibaba/wan-3.0":
      usd = rates.wan[resolution] * durationSeconds;
      break;
    case "kling-video/v3.0/std":
      usd = rates.klingPerSecond * durationSeconds;
      break;
    case "bytedance/seedance-2.0": {
      const { width, height } = PORTRAIT_SIZES[resolution];
      const tokens = Math.ceil((durationSeconds * width * height * 24) / 1024);
      usd = (tokens / 1000) * rates.seedancePerThousandTokens;
      break;
    }
  }
  return Math.round(usd * 10_000) / 10_000;
}
