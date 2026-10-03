import { PermanentError } from "@rc/lib/errors";
import { z } from "zod";
import { audit } from "./core/audit";
import { defineJob } from "./core/job-runner";

// Job name → handler (plan 06 §6.5). Used by Trigger.dev tasks (jobs/) and the inline runner.
// Handlers are thin: business logic lives in the module services they call.

/** Smoke job (M0-14): writes one audit event. */
export const helloJob = defineJob({
  payload: z.object({
    name: z.string().min(1).max(100).default("world"),
    /** Throw instead of writing the audit event (M0-19 check: the failure must reach Sentry). */
    fail: z.boolean().default(false),
  }),
  run: async (ctx, { name, fail }) => {
    if (fail) {
      throw new PermanentError(
        "hello failed on purpose (M0-19): GET https://graph.instagram.com/me?access_token=IGQV-fake-job-token",
      );
    }
    const auditEventId = await audit(ctx, {
      action: "job.hello",
      entityType: "job",
      data: { name },
    });
    ctx.logger.info({ auditEventId }, "hello job ran");
    return { auditEventId };
  },
});

/**
 * J1 (plan 06 §6.3). Stub until M1-15 (ingestion orchestrator): the source stays QUEUED and the
 * run only records that the job arrived.
 */
export const ingestSourceJob = defineJob({
  payload: z.object({ sourceAssetId: z.uuid(), attempt: z.number().int().positive() }),
  run: async (ctx, { sourceAssetId, attempt }) => {
    ctx.logger.warn({ sourceAssetId, attempt }, "ingest-source is a stub until M1-15");
    return { stub: true as const };
  },
});

export const jobHandlers = {
  hello: helloJob,
  "ingest-source": ingestSourceJob,
};

type JobHandlers = typeof jobHandlers;

declare module "./core/job-runner" {
  interface JobRegistry extends JobHandlers {}
}
