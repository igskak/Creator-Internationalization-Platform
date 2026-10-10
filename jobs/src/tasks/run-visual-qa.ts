import { handlerTask } from "../handler-task";
import { llmQueue } from "../queues";

/** J21 (plan 07 §7.6.1): the vision check of one variant's rendered slides; a few minutes at most. */
export const runVisualQa = handlerTask("run-visual-qa", {
  queue: llmQueue,
  maxDuration: 5 * 60,
});
