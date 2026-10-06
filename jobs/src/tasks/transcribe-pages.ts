import { handlerTask } from "../handler-task";
import { llmQueue } from "../queues";

/** J19 (plan 06 §6.3): vision transcription of scanned pages; calls the model, so the llm queue. */
export const transcribePages = handlerTask("transcribe-pages", {
  queue: llmQueue,
  maxDuration: 30 * 60,
});
