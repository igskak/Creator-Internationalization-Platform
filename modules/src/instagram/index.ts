export const MODULE_NAME = "instagram";

export {
  decryptAccessToken,
  encryptAccessToken,
  INSTAGRAM_SCOPES,
  LONG_LIVED_TOKEN_SECONDS,
  type SocialAccount,
  type SocialAccountView,
  toAccountView,
} from "./accounts";
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
export {
  completeInstagramOAuth,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  type OAuthFailureReason,
  type OAuthResult,
  startInstagramOAuth,
} from "./oauth";
