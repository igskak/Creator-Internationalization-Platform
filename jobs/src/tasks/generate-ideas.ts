import { handlerTask } from "../handler-task";
import { llmQueue } from "../queues";

/** J4 (plan 06 §6.2): Master Ideas from approved cards. */
export const generateIdeas = handlerTask("generate-ideas", { queue: llmQueue });
