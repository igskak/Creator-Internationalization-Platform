export const MODULE_NAME = "youtube";

export {
  createYouTubeClient,
  receivedBytes,
  requireYouTubeApp,
  type UploadAnswer,
  YOUTUBE_SCOPES,
  type YouTubeClient,
} from "./client";
export {
  classifyYouTubeError,
  isRetryableYouTubeError,
  YouTubeCallError,
  type YouTubeErrorClass,
} from "./errors";
export {
  buildShortMetadata,
  cutAtWord,
  MAX_DESCRIPTION_BYTES,
  MAX_TITLE_CHARS,
  metadataProblems,
  SHORTS_TAG,
  shortDescription,
  shortTags,
  shortTitle,
} from "./metadata";
export {
  DryRunYouTubeInput,
  dryRunYouTubeUpload,
  formatYouTubeStatus,
  getYouTubeStatus,
  nextYouTubeCandidate,
  retryYouTubeUpload,
  SYNC_MAX_AGE_DAYS,
  SyncYouTubeInput,
  type SyncYouTubeResult,
  syncYouTubeShorts,
  type YouTubeStatus,
  type YouTubeUploadRow,
} from "./sync";
export {
  checkYouTubeSwitches,
  isYouTubeEnabled,
  MAX_YOUTUBE_ATTEMPTS,
  runYouTubeUpload,
  shortUrl,
  YouTubeGuardFailure,
  type YouTubeUploadOutcome,
  youtubePrivacyStatus,
} from "./upload";
