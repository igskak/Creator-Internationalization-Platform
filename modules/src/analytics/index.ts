export const MODULE_NAME = "analytics";

export {
  type AccountInsightsResult,
  CollectAccountInsightsInput,
  type CollectedSnapshot,
  CollectInsightsInput,
  type CollectInsightsResult,
  collectAccountInsights,
  collectInsights,
  MAX_PER_RUN,
  previousLocalDay,
  RequestMetricsInput,
  requestMetricsNow,
} from "./collect";
export {
  AUTOMATIC_SLOTS,
  type AutomaticSlot,
  type ExistingSnapshot,
  mediaAgeHours,
  type PlannedSnapshot,
  planSnapshot,
  SLOT_HOURS,
  SLOT_TOLERANCE_HOURS,
  type SnapshotSlotName,
  slotDueAt,
} from "./slots";
