import { handlerTask } from "../handler-task";
import { defaultQueue } from "../queues";

/** J3 (plan 06 §6.3): card embeddings and duplicate suggestions. */
export const embedKnowledgeItems = handlerTask("embed-knowledge-items", { queue: defaultQueue });
