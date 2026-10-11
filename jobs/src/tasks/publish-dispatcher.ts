import { cronHandlerTask } from "../handler-task";
import { defaultQueue } from "../queues";

/** J9 (plan 06 §6.2): every minute; no retry, the next tick is the retry. */
export const publishDispatcher = cronHandlerTask("publish-dispatcher", "* * * * *", {
  queue: defaultQueue,
  maxDuration: 60,
  retry: { maxAttempts: 1 },
});
