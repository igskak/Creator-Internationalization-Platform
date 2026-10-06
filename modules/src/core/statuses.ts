import { schema } from "@rc/db";
import { inArray } from "@rc/db/orm";
import { z } from "zod";
import type { ServiceContext } from "./context";
import { progressPercent } from "./progress";

// getStatuses (plan 05 §5.7): the UI polls it every 3 s while an item is in progress (10 §10.5). Each
// kind is answered by the task that creates its table: sources here (M1-04); variants M2-14, renders
// and publications later. Until then unknown ids are simply absent.

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

export async function getStatuses(ctx: ServiceContext, input: StatusesInput): Promise<Statuses> {
  const statuses: Statuses = {};
  if (input.sourceIds?.length) {
    const rows = await ctx.db
      .select()
      .from(schema.sourceAssets)
      .where(inArray(schema.sourceAssets.id, input.sourceIds));
    for (const s of rows) {
      const percent = progressPercent(s);
      statuses[s.id] = {
        status: s.processingStatus,
        ...(percent === null ? {} : { progress: percent }),
        ...(s.processingError ? { error: s.processingError.message } : {}),
      };
    }
  }
  return statuses;
}
