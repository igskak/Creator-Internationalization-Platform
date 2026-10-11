export const MODULE_NAME = "publishing";

export {
  type ApprovedDraft,
  CALENDAR_STATUSES,
  type CalendarItem,
  type CalendarWarning,
  GetCalendarInput,
  getCalendar,
  listApprovedNotScheduled,
} from "./calendar";
export {
  captionProblems,
  captionStats,
  composeCaption,
  MAX_CAPTION_CHARS,
  MAX_CAPTION_HASHTAGS,
  MAX_CAPTION_MENTIONS,
  normalizeCaption,
} from "./caption";
export {
  type ErrorKind,
  errorKind,
  GetPublicationInput,
  getPublicationDetails,
  listVariantPublications,
  type PublicationAttempt,
  type PublicationDetails,
  type PublicationError,
  type PublicationSummary,
  type VariantPublications,
} from "./details";
export {
  DISPATCH_BATCH,
  type DispatchResult,
  dispatchDuePublications,
  ORPHAN_AFTER_MS,
  STUCK_AFTER_MS,
} from "./dispatcher";
export {
  checkG2Readiness,
  formatG2Readiness,
  G2_FIRST_POSTS_PER_MARKET,
  type G2Item,
  type G2Readiness,
  type G2State,
} from "./g2";
export {
  getPublishingStatus,
  type PublishingStatus,
  SetPublishingEnabledInput,
  setPublishingEnabled,
} from "./kill-switch";
export {
  MAX_PUBLISH_ATTEMPTS,
  PUBLISH_LEASE_MS,
  PUBLISH_STEPS,
  type PublishOutcome,
  type PublishStep,
  runPublication,
  WAIT_READY_MAX_MS,
} from "./publish-machine";
export { startPublishJob } from "./queue";
export { RetryPublicationInput, retryPublication } from "./retry";
export { GUARD_CODES, type GuardCode, GuardFailure } from "./safeguards";
export {
  CancelPublicationInput,
  cancelPublication,
  describeSlot,
  MIN_LEAD_MINUTES,
  ReschedulePublicationInput,
  reschedulePublication,
  SchedulePublicationInput,
  type ScheduleResult,
  type ScheduleWarning,
  schedulePublication,
  scheduleWarnings,
} from "./schedule";
export { isPublishingEnabled } from "./settings";
export {
  formatLocalDateTime,
  type LocalDateTime,
  localDate,
  localParts,
  offsetLabel,
  parseLocalDateTime,
  zonedToUtc,
  zoneOffsetMinutes,
} from "./time";
