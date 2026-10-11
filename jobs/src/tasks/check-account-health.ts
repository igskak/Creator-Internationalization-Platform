import { cronHandlerTask } from "../handler-task";
import { instagramReadQueue } from "../queues";

/** J14 (plan 06 §6.2): profile and publishing-limit check of each account, every 6 hours at :23. */
export const checkAccountHealth = cronHandlerTask("check-account-health", "23 */6 * * *", {
  queue: instagramReadQueue,
  maxDuration: 10 * 60,
});
