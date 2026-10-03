import { handlerTask } from "../handler-task";
import { llmQueue } from "../queues";

/** J2 (plan 06 §6.3): one extraction batch; calls the model, so it runs on the llm queue. */
export const extractKnowledgeBatch = handlerTask("extract-knowledge-batch", {
  queue: llmQueue,
  maxDuration: 20 * 60,
});
