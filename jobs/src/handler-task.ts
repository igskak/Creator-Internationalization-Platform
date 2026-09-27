import type { JobEnvelope, JobName } from "@rc/modules/core";
import { runJobHandler } from "@rc/modules/core";
import { jobHandlers } from "@rc/modules/job-handlers";
import { type Queue, task } from "@trigger.dev/sdk";
import { classifyJobError } from "./errors";
import { jobContext } from "./runtime";

/** Machine presets the plan uses (06 §6.1): default small-1x; Chromium and big PDFs medium-1x. */
export type Machine = "small-1x" | "medium-1x";

/** Trigger.dev task whose id is the job name and whose body is the registered handler. */
export function handlerTask(
  name: JobName,
  options: { queue: Queue; machine?: Machine; maxDuration?: number },
) {
  return task({
    id: name,
    queue: options.queue,
    ...(options.machine ? { machine: options.machine } : {}),
    ...(options.maxDuration ? { maxDuration: options.maxDuration } : {}),
    run: async (envelope: JobEnvelope, { ctx }) => {
      const serviceCtx = jobContext(ctx.run.id, name, envelope.meta ?? {});
      try {
        return await runJobHandler(jobHandlers[name], serviceCtx, envelope.payload);
      } catch (error) {
        throw classifyJobError(error);
      }
    },
  });
}
