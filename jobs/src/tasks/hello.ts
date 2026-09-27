import { handlerTask } from "../handler-task";
import { defaultQueue } from "../queues";

/** Smoke task: writes one audit event (M0-14). Trigger with `pnpm jobs:hello`. */
export const hello = handlerTask("hello", { queue: defaultQueue });
