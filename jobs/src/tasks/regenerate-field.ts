import { handlerTask } from "../handler-task";
import { llmQueue } from "../queues";

/** J6 (plan 06 §6.2): the model rewrites one field of a draft; a minute or two. */
export const regenerateField = handlerTask("regenerate-field", {
  queue: llmQueue,
  maxDuration: 5 * 60,
});
