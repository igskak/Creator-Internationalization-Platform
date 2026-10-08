import { PermanentError } from "@rc/lib/errors";
import { z } from "zod";
import { GenerateContentPayload, generateVariants } from "./content";
import { GenerateIdeasPayload, runGenerateIdeas } from "./content/ideas";
import { audit } from "./core/audit";
import { defineJob } from "./core/job-runner";
import { embedAndSuggest } from "./knowledge/embedding";
import { extractBatch } from "./knowledge/extraction";
import { ingestSource } from "./knowledge/ingest-source";
import {
  AnnotatePostsInput,
  annotateHistoricalPosts,
  importHistoricalPosts,
} from "./knowledge/posts";
import { TranscribePagesInput, transcribeSourcePages } from "./knowledge/transcription";

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

/**
 * J16 (plan 06 §6.3): reads a stored posts file and upserts the posts. A file that cannot be read
 * ends the import as FAILED and returns normally; bad rows are reported on the source.
 */
export const importHistoricalPostsJob = defineJob({
  payload: z.object({ sourceAssetId: z.uuid() }),
  run: (ctx, payload) => importHistoricalPosts(ctx, payload),
});

/**
 * J17 (plan 06 §6.3): suggests taxonomy codes for up to 50 posts. Posts a person confirmed, posts
 * without a caption and posts whose import forbids AI processing are skipped and reported.
 */
export const annotateHistoricalPostsJob = defineJob({
  payload: AnnotatePostsInput,
  run: (ctx, payload) => annotateHistoricalPosts(ctx, payload),
});

/**
 * J19 (plan 06 §6.3): transcribes pages of a PDF that have no text layer, then checks again the
 * quotes of the cards from those pages. A page the model cannot read stays open.
 */
export const transcribePagesJob = defineJob({
  payload: TranscribePagesInput,
  run: (ctx, payload) => transcribeSourcePages(ctx, payload),
});

/**
 * J4 (plan 06 §6.2): asks the idea generator for ideas and stores them as PROPOSED with their
 * card links. A failed request (no cards, unusable answer) is an outcome, not an exception; a
 * second run with the same request id returns the stored outcome.
 */
export const generateIdeasJob = defineJob({
  payload: GenerateIdeasPayload,
  run: (ctx, payload) => runGenerateIdeas(ctx, payload),
});

/**
 * J5 (plan 06 §6.3): runs the variant pipeline for the given variants (07 §7.6.2). A variant the
 * pipeline could not finish is DRAFT with `GENERATION_FAILED` in the result, not an exception;
 * transient errors are rethrown and the run resumes with the same `pipelineRunId`.
 */
export const generateContentJob = defineJob({
  payload: GenerateContentPayload,
  run: (ctx, payload) => generateVariants(ctx, payload),
});

export const jobHandlers = {
  hello: helloJob,
  "ingest-source": ingestSourceJob,
  "generate-ideas": generateIdeasJob,
  "generate-content": generateContentJob,
  "extract-knowledge-batch": extractKnowledgeBatchJob,
  "embed-knowledge-items": embedKnowledgeItemsJob,
  "import-historical-posts": importHistoricalPostsJob,
  "annotate-historical-posts": annotateHistoricalPostsJob,
  "transcribe-pages": transcribePagesJob,
};

type JobHandlers = typeof jobHandlers;

declare module "./core/job-runner" {
  interface JobRegistry extends JobHandlers {}
}
