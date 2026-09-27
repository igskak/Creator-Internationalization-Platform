import { z } from "zod";
import type { ServiceContext } from "./context";

// getStatuses (plan 05 §5.7): the UI polls it every 3 s while an item is in progress (10 §10.5). Skeleton: each kind is answered by the task that creates its table (sources M1-03,
// variants M2-14, renders and publications later). Until then unknown ids are simply absent.

const Ids = z.array(z.uuid()).max(100).optional();

export const StatusesInput = z.object({
  sourceIds: Ids,
  variantIds: Ids,
  renderIds: Ids,
  publicationIds: Ids,
});
export type StatusesInput = z.infer<typeof StatusesInput>;

export type StatusEntry = {
  status: string;
  /** 0–100 while in progress, when the job reports it. */
  progress?: number;
  flags?: string[];
  /** User-facing error text of a failed item. */
  error?: string;
};

/** Current status per requested id. Ids that are unknown (or not visible) are left out. */
export type Statuses = Record<string, StatusEntry>;

export async function getStatuses(_ctx: ServiceContext, _input: StatusesInput): Promise<Statuses> {
  return {};
}
