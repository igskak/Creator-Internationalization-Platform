import { handlerTask } from "../handler-task";
import { llmQueue } from "../queues";

/** J22: the visual director replans one variant's pictures, then J7 draws them; a minute or two. */
export const regenerateVisuals = handlerTask("regenerate-visuals", {
  queue: llmQueue,
  maxDuration: 5 * 60,
});
