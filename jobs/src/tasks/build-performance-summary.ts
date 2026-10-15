import { cronHandlerTask } from "../handler-task";
import { defaultQueue } from "../queues";

/**
 * J15 (plan 06 §6.2): the performance summaries of every active market and across markets, weekly
 * on Monday at 04:11 UTC; also started by "Build now" on the Learning summary (M7-03).
 */
export const buildPerformanceSummary = cronHandlerTask("build-performance-summary", "11 4 * * 1", {
  queue: defaultQueue,
  maxDuration: 5 * 60,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 30_000, maxTimeoutInMs: 5 * 60_000 },
});
