import { cronHandlerTask } from "../handler-task";
import { instagramReadQueue } from "../queues";

/** J12 (plan 06 §6.2): yesterday's account metrics of each account, daily at 02:17 UTC. */
export const collectAccountInsights = cronHandlerTask("collect-account-insights", "17 2 * * *", {
  queue: instagramReadQueue,
  maxDuration: 10 * 60,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 60_000, maxTimeoutInMs: 15 * 60_000 },
});
