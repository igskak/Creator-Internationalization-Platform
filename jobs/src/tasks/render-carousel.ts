import { handlerTask } from "../handler-task";
import { renderQueue } from "../queues";

/** J8 (plan 06 §6.2): Chromium render of one variant; a medium machine, up to 10 minutes. */
export const renderCarousel = handlerTask("render-carousel", {
  queue: renderQueue,
  machine: "medium-1x",
  maxDuration: 10 * 60,
});
