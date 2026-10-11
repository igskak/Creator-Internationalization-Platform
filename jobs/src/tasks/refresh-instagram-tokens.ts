import { cronHandlerTask } from "../handler-task";
import { instagramReadQueue } from "../queues";

/** J13 (plan 06 §6.2): refreshes due Instagram tokens, daily at 03:13 UTC. */
export const refreshInstagramTokens = cronHandlerTask("refresh-instagram-tokens", "13 3 * * *", {
  queue: instagramReadQueue,
  maxDuration: 10 * 60,
});
