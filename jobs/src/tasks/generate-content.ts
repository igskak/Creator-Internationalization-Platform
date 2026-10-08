import { handlerTask } from "../handler-task";
import { llmQueue } from "../queues";

/** J5 (plan 06 §6.2): the variant pipeline of one Master Idea; up to 30 minutes. */
export const generateContent = handlerTask("generate-content", {
  queue: llmQueue,
  maxDuration: 30 * 60,
});
