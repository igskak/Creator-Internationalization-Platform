import { handlerTask } from "../handler-task";
import { instagramPublishQueue } from "../queues";

/**
 * J10 (plan 06 §6.2): the publish state machine. One run at a time per Instagram account (the
 * trigger sets `concurrencyKey` to the account), up to 30 minutes (it waits for Instagram), five
 * attempts from 30 s to 10 min. The idempotency key is the publication's own.
 */
export const publishContent = handlerTask("publish-content", {
  queue: instagramPublishQueue,
  maxDuration: 30 * 60,
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 600_000,
    randomize: true,
  },
});
