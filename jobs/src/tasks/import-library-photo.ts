import { handlerTask } from "../handler-task";
import { imagesQueue } from "../queues";

/** J20 (plan 08 §8.4): turns an uploaded PHOTO source into a library photo. */
export const importLibraryPhoto = handlerTask("import-library-photo", {
  queue: imagesQueue,
  maxDuration: 5 * 60,
});
