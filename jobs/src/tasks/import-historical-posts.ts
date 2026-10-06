import { handlerTask } from "../handler-task";
import { defaultQueue } from "../queues";

/** J16 (plan 06 §6.3): imports a historical posts file. */
export const importHistoricalPosts = handlerTask("import-historical-posts", {
  queue: defaultQueue,
});
