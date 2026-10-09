import { handlerTask } from "../handler-task";
import { imagesQueue } from "../queues";

/** J7 (plan 06 §6.2): the pictures of one variant; up to 15 minutes. */
export const generateVisualAssets = handlerTask("generate-visual-assets", {
  queue: imagesQueue,
  maxDuration: 15 * 60,
});
