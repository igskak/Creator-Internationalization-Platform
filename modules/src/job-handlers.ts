import { PermanentError } from "@rc/lib/errors";
import { z } from "zod";
import { audit } from "./core/audit";
import { defineJob } from "./core/job-runner";
import { embedAndSuggest } from "./knowledge/embedding";
import { extractBatch } from "./knowledge/extraction";
import { ingestSource } from "./knowledge/ingest-source";

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
 * J1 (plan 06 §6.3): rights gate, sniff, parse, plan, extract every batch, finalize. Permanent
 * failures end the source as FAILED and return normally (a retry would not help); a rights block
 * throws RightsBlockedError (not retried); transient errors are rethrown and the run resumes.
 */
export const ingestSourceJob = defineJob({
  payload: z.object({
    sourceAssetId: z.uuid(),
    attempt: z.number().int().positive(),
    mode: z.enum(["FULL", "KNOWLEDGE_ONLY"]).default("FULL"),
  }),
  run: (ctx, payload) => ingestSource(ctx, payload),
});

/**
 * J2 (plan 06 §6.3): extracts the cards of one batch. A permanent failure is a FAILED batch in
 * the result, not an exception (retrying would not help); transient errors are rethrown.
 */
export const extractKnowledgeBatchJob = defineJob({
  payload: z.object({ batchId: z.uuid() }),
  run: (ctx, { batchId }) => extractBatch(ctx, { batchId }),
});

/**
 * J3 (plan 06 §6.3): embeds cards and suggests duplicates. With ids it handles those cards; with
 * none it handles every card whose vector is missing or from another model (backfill, re-embed
 * after a model change).
 */
export const embedKnowledgeItemsJob = defineJob({
  payload: z.object({ knowledgeItemIds: z.array(z.uuid()).max(500).optional() }),
  run: (ctx, { knowledgeItemIds }) => embedAndSuggest(ctx, { knowledgeItemIds }),
});

export const jobHandlers = {
  hello: helloJob,
  "ingest-source": ingestSourceJob,
  "extract-knowledge-batch": extractKnowledgeBatchJob,
  "embed-knowledge-items": embedKnowledgeItemsJob,
};

type JobHandlers = typeof jobHandlers;

declare module "./core/job-runner" {
  interface JobRegistry extends JobHandlers {}
}
