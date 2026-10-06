import { handlerTask } from "../handler-task";
import { llmQueue } from "../queues";

/** J17 (plan 06 §6.3): suggested annotations for historical posts. */
export const annotateHistoricalPosts = handlerTask("annotate-historical-posts", {
  queue: llmQueue,
});
