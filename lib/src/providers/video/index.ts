export { createVideoProvider, type VideosConfig } from "./factory";
export { createFakeVideoProvider, type FakeVideoOptions, fakeMp4 } from "./fake";
export { createHiggsfieldVideoProvider, type HiggsfieldOptions } from "./higgsfield";
export {
  DEFAULT_RATES,
  estimateShotCostUsd,
  PORTRAIT_SIZES,
  type Rates,
  shotDurationRange,
} from "./rates";
export {
  type AwaitOptions,
  DEFAULT_VIDEO_MODEL,
  type GeneratedShot,
  type ShotHandle,
  type ShotImage,
  type ShotRequest,
  VIDEO_MODELS,
  type VideoModelId,
  type VideoProvider,
  type VideoResolution,
} from "./types";
