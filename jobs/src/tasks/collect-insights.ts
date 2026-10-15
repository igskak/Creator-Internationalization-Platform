import { cronHandlerTask } from "../handler-task";
import { instagramReadQueue } from "../queues";

/** J11 (plan 06 §6.2): the due insights snapshots, hourly at :07; also run by `collectMetricsNow`. */
export const collectInsights = cronHandlerTask("collect-insights", "7 * * * *", {
  queue: instagramReadQueue,
  maxDuration: 10 * 60,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 60_000, maxTimeoutInMs: 15 * 60_000 },
});
