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
  CONTAINER_STATUSES,
  type ContainerStatus,
  createCarouselContainer,
  createChildContainer,
  createReelContainer,
  getContainerStatus,
  getFollowerCount,
  getMedia,
  getPublishingLimit,
  listRecentMedia,
  publishContainer,
  type RecentMediaItem,
} from "./api";
export {
  DELETION_CODE_PATTERN,
  type DeletionStatus,
  getDeletionStatus,
  handleDataDeletion,
  handleDeauthorize,
  InvalidSignedRequestError,
} from "./callbacks";
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
  type IntegrationEventInput,
  recordIntegrationEvent,
  resolveIntegrationEvents,
} from "./events";
export { CheckHealthInput, checkInstagramAccountHealth, type HealthCheckResult } from "./health";
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
export {
  formatSmokeReport,
  makeSmokeSlides,
  runInstagramSmoke,
  type SmokeInput,
  type SmokeReport,
  type SmokeStep,
} from "./smoke";
export {
  type AccountHealth,
  accountHealth,
  DisconnectAccountInput,
  disconnectInstagramAccount,
  EXPIRING_DAYS,
  getInstagramBanners,
  getInstagramOverview,
  type InstagramBanner,
  type InstagramMarketRow,
  type InstagramOverview,
} from "./status";
export {
  MIN_REFRESH_AGE_MS,
  markAccountNeedsReauth,
  REFRESH_AT_AGE_DAYS,
  REFRESH_WHEN_EXPIRING_DAYS,
  type RefreshDecision,
  RefreshTokensInput,
  refreshDecision,
  refreshInstagramTokens,
  type TokenRefreshOutcome,
  type TokenRefreshResult,
} from "./tokens";
