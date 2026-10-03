import { handlerTask } from "../handler-task";
import { defaultQueue } from "../queues";

/** J1 (plan 06 §6.3): handler is a stub until M1-15. Big PDFs need the medium machine. */
export const ingestSource = handlerTask("ingest-source", {
  queue: defaultQueue,
  machine: "medium-1x",
  maxDuration: 60 * 60,
});
