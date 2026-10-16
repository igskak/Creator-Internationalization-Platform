import { cronHandlerTask } from "../handler-task";
import { instagramReadQueue } from "../queues";

/**
 * J12 (plan 06 §6.2): yesterday's account metrics of each account. Hourly: each account is read once
 * its market's clock has passed 02:00 (G-03), so a market's day is stored within hours of its end.
 */
export const collectAccountInsights = cronHandlerTask("collect-account-insights", "17 * * * *", {
  queue: instagramReadQueue,
  maxDuration: 10 * 60,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 60_000, maxTimeoutInMs: 15 * 60_000 },
});
