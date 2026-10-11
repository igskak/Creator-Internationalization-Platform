export const MODULE_NAME = "instagram";

export {
  classifyInstagramError,
  containerError,
  describeInstagramError,
  type FailureSignal,
  graphErrorBody,
  InstagramCallError,
  type InstagramErrorClass,
  isMediaFetchFailure,
  isRetryableInstagramError,
  retryAfterMs,
} from "./errors";
export {
  authorizeUrl,
  createGraphClient,
  DEFAULT_TIMEOUT_MS,
  type GraphCallRecord,
  type GraphClient,
  type GraphClientOptions,
  type GraphParams,
  oauthBaseUrl,
  oauthCall,
  pathOnly,
  requireInstagramApp,
} from "./http";
