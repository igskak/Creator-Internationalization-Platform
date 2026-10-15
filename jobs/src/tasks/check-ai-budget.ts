import { cronHandlerTask } from "../handler-task";
import { defaultQueue } from "../queues";
import { reportBudgetAlert } from "../sentry";

/** J24 (H-05): the month's AI cost against the budget, daily at 06:05 UTC; an alert goes to Sentry. */
export const checkAiBudget = cronHandlerTask("check-ai-budget", "5 6 * * *", {
  queue: defaultQueue,
  maxDuration: 2 * 60,
  onResult: reportBudgetAlert,
});
