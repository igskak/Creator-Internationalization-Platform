import { z } from "zod";
import { audit } from "./core/audit";
import { defineJob } from "./core/job-runner";

// Job name → handler (plan 06 §6.5). Used by Trigger.dev tasks (jobs/) and the inline runner.
// Handlers are thin: business logic lives in the module services they call.

/** Smoke job (M0-14): writes one audit event. */
export const helloJob = defineJob({
  payload: z.object({ name: z.string().min(1).max(100).default("world") }),
  run: async (ctx, { name }) => {
    const auditEventId = await audit(ctx, {
      action: "job.hello",
      entityType: "job",
      data: { name },
    });
    ctx.logger.info({ auditEventId }, "hello job ran");
    return { auditEventId };
  },
});

export const jobHandlers = {
  hello: helloJob,
};

type JobHandlers = typeof jobHandlers;

declare module "./core/job-runner" {
  interface JobRegistry extends JobHandlers {}
}
