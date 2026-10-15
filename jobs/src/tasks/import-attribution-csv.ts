import { handlerTask } from "../handler-task";
import { defaultQueue } from "../queues";

/** J18 (plan 06 §6.3): imports a CSV of leads, sales and refunds (M6-08). */
export const importAttributionCsv = handlerTask("import-attribution-csv", {
  queue: defaultQueue,
});
