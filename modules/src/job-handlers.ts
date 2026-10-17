import { PermanentError } from "@rc/lib/errors";
import { z } from "zod";
import { checkAiBudget } from "./ai";
import {
  BuildSummariesPayload,
  buildPerformanceSummaries,
  CollectAccountInsightsInput,
  CollectInsightsInput,
  collectAccountInsights,
  collectInsights,
  ensureFreshSummaries,
  ImportAttributionPayload,
  importAttributionCsv,
} from "./analytics";
import {
  GenerateContentPayload,
  generateVariants,
  RegenerateFieldPayload,
  RegenerateVisualsPayload,
  runFieldRegeneration,
  runVisualsRegeneration,
} from "./content";
import { GenerateIdeasPayload, runGenerateIdeas } from "./content/ideas";
import { audit } from "./core/audit";
import { defineJob, triggerJob } from "./core/job-runner";
import {
  CheckHealthInput,
  checkInstagramAccountHealth,
  RefreshTokensInput,
  refreshInstagramTokens,
} from "./instagram";
import { embedAndSuggest } from "./knowledge/embedding";
import { extractBatch } from "./knowledge/extraction";
import { ingestSource } from "./knowledge/ingest-source";
import {
  AnnotatePostsInput,
  annotateHistoricalPosts,
  importHistoricalPosts,
} from "./knowledge/posts";
import { TranscribePagesInput, transcribeSourcePages } from "./knowledge/transcription";
import { dispatchDuePublications, runPublication } from "./publishing";
import { GenerateReelPayload, generateReel } from "./reels";
import {
  GenerateVisualAssetsPayload,
  generateVisualAssets,
  importLibraryPhoto,
  RenderCarouselPayload,
  RunVisualQaPayload,
  requestRender,
  runVisualQa,
} from "./visuals";
import { SyncYouTubeInput, syncYouTubeShorts } from "./youtube";

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
  run: async (ctx, payload) => {
    // J15 before J4 when the performance memory is more than a week old (06 §6.3). A failure here
    // must not cost the ideas: they are made without a fresh summary.
    await ensureFreshSummaries(ctx).catch((error: unknown) =>
      ctx.logger.warn({ err: error }, "could not refresh the performance summaries"),
    );
    return runGenerateIdeas(ctx, payload);
  },
});

/**
 * J5 (plan 06 §6.3): runs the variant pipeline for the given variants (07 §7.6.2). A variant the
 * pipeline could not finish is DRAFT with `GENERATION_FAILED` in the result, not an exception;
 * transient errors are rethrown and the run resumes with the same `pipelineRunId`.
 */
export const generateContentJob = defineJob({
  payload: GenerateContentPayload,
  run: async (ctx, payload) => {
    const result = await generateVariants(ctx, payload);
    // J7 per finished variant that has a visual brief (06 §6.3 J5 step 3).
    for (const outcome of result.outcomes) {
      if (outcome.status !== "READY_FOR_REVIEW") continue;
      await triggerJob(
        ctx,
        "generate-visual-assets",
        { variantId: outcome.variantId },
        { idempotencyKey: `visuals:${result.pipelineRunId}:${outcome.variantId}` },
      );
    }
    return result;
  },
});

/**
 * J7 (plan 06 §6.2): plans' pictures of one variant: provider call, normalization, storage, one
 * `visual_assets` row per slot. A slot that failed is in the result (retry it with `slots`), not
 * an exception; a provider that is down is rethrown so the run is retried.
 */
export const generateVisualAssetsJob = defineJob({
  payload: GenerateVisualAssetsPayload,
  run: async (ctx, payload) => {
    const result = await generateVisualAssets(ctx, payload);
    // The pictures are in: render the carousel (J8). A variant that no longer can be rendered
    // (changed meanwhile) is not an error of this job.
    await requestRender(ctx, payload.variantId).catch((error: unknown) =>
      ctx.logger.warn({ err: error, variantId: payload.variantId }, "could not queue the render"),
    );
    return result;
  },
});

/**
 * J8 (plan 06 §6.2): renders the slides of a variant with Chromium and stores the JPEGs, the QA
 * report and the flags. The browser code is loaded on demand, so the web app that registers the
 * handlers does not load Playwright.
 */
export const renderCarouselJob = defineJob({
  payload: RenderCarouselPayload,
  run: async (ctx, payload) => {
    const { renderVariantCarousel } = await import("./visuals/render");
    return renderVariantCarousel(ctx, payload);
  },
});

/**
 * J20 (plan 08 §8.4): turns an uploaded PHOTO source into a library photo (`visual_assets`). A file
 * that is not an image ends the source as FAILED and returns normally.
 */
export const importLibraryPhotoJob = defineJob({
  payload: z.object({ sourceAssetId: z.uuid(), attempt: z.number().int().positive() }),
  run: (ctx, payload) => importLibraryPhoto(ctx, payload),
});

/**
 * J21 (plan 07 §7.6.1): the vision check of a variant's rendered slides. Findings are added to the
 * critic report; a variant that cannot be checked yet is an error the person sees.
 */
export const runVisualQaJob = defineJob({
  payload: RunVisualQaPayload,
  run: (ctx, payload) => runVisualQa(ctx, payload),
});

/**
 * J6 (plan 06 §6.2): the model writes a new value for one field of a draft and it is applied as a
 * REGENERATE review event. A result the reviewer outran (the lock version moved), or that does
 * not pass the checks, is an outcome, not an exception; transient errors are rethrown.
 */
export const regenerateFieldJob = defineJob({
  payload: RegenerateFieldPayload,
  run: (ctx, payload) => runFieldRegeneration(ctx, payload),
});

/**
 * J22: "Regenerate pictures" of one variant: the visual director plans the pictures again from the
 * current slides, then J7 draws them (and queues the render). The text is not touched.
 */
export const regenerateVisualsJob = defineJob({
  payload: RegenerateVisualsPayload,
  run: (ctx, payload) => runVisualsRegeneration(ctx, payload),
});

/**
 * J13 (plan 06 §6.3): refreshes the long-lived Instagram tokens that are due (daily cron). A token
 * Instagram refuses makes the account NEEDS_REAUTH and returns normally; a transient failure is
 * rethrown after the other accounts are done, and the retry touches only what is still due.
 */
export const refreshInstagramTokensJob = defineJob({
  payload: RefreshTokensInput,
  run: (ctx, payload) => refreshInstagramTokens(ctx, payload),
});

/**
 * J14 (plan 06 §6.3): asks each ACTIVE account for its profile and publishing limit (every six
 * hours, or by hand). Failures are recorded on the account, not thrown.
 */
export const checkAccountHealthJob = defineJob({
  payload: CheckHealthInput,
  run: (ctx, payload) => checkInstagramAccountHealth(ctx, payload),
});

/**
 * J11 (plan 06 §6.3, 11 §11.2): the snapshots that are due, hourly at :07, or one manual snapshot
 * of one post. One failing post is a finding on its account and does not stop the others; a rate
 * limit is rethrown for the backoff, what was stored stays.
 */
export const collectInsightsJob = defineJob({
  payload: CollectInsightsInput,
  run: (ctx, payload) => collectInsights(ctx, payload),
});

/** J12 (plan 06 §6.3): yesterday's account metrics, daily at 02:17 UTC; one row per account and day. */
export const collectAccountInsightsJob = defineJob({
  payload: CollectAccountInsightsInput,
  run: (ctx, payload) => collectAccountInsights(ctx, payload),
});

/**
 * J18 (plan 06 §6.3, 11 §11.7): imports a stored CSV of leads, sales and refunds. References that
 * are in the table already are skipped, so a second run adds nothing; a file that cannot be read is
 * a report with the error, not an exception.
 */
export const importAttributionCsvJob = defineJob({
  payload: ImportAttributionPayload,
  run: (ctx, payload) => importAttributionCsv(ctx, payload),
});

/**
 * J15 (plan 06 §6.3, 11 §11.5): the performance summaries, weekly (Monday 04:11 UTC), on request,
 * and before ideas when they are older than a week. SQL only; every run stores new rows.
 */
export const buildPerformanceSummaryJob = defineJob({
  payload: BuildSummariesPayload,
  run: (ctx, payload) => buildPerformanceSummaries(ctx, payload),
});

/**
 * J24 (H-05, plan 12 §12.9): the AI cost of the month against `ai.monthly_budget_usd`, daily. A
 * new level (amber at 80 %, red above 100 %) is returned once per month as `alert`; the task
 * reports it to Sentry, which sends the e-mail.
 */
export const checkAiBudgetJob = defineJob({
  payload: z.object({}).default({}),
  run: (ctx) => checkAiBudget(ctx),
});

/**
 * J9 (plan 06 §6.3): every minute, hands the due publications to the publish job and restarts the
 * ones that were lost. It never fails the cron run for one bad publication.
 */
export const publishDispatcherJob = defineJob({
  payload: z.object({}).default({}),
  run: (ctx) => dispatchDuePublications(ctx),
});

/**
 * J10 (plan 06 §6.3): the publish state machine for one publication (09 §9.4). A post that could
 * not be published ends as FAILED in the database and the job returns normally (the person retries
 * it); a failure that may pass is rethrown so Trigger.dev retries, and the run resumes at its step.
 */
export const publishContentJob = defineJob({
  payload: z.object({ publicationId: z.uuid() }),
  run: (ctx, payload) => runPublication(ctx, payload),
});

/**
 * J23 (plan 06 §6.3, plan 18 §18.4): the Reel pipeline for one Reel variant: director, shots,
 * assembly, checks. A permanent failure ends the variant as DRAFT with a flag and the job returns;
 * a transient one is rethrown, the variant stays GENERATING and the run resumes at its stage.
 */
export const generateReelJob = defineJob({
  payload: GenerateReelPayload,
  run: (ctx, payload) => generateReel(ctx, payload),
});

/**
 * J25 (task G-09, docs/design/youtube-shorts.md): hourly, one published English Reel to the
 * YouTube channel as a Short, when YOUTUBE_PUBLISH_MODE and `youtube.enabled` allow it. An upload
 * that cannot succeed ends FAILED and the job returns; a failure that may pass is rethrown and the
 * upload resumes at its step with the same upload session.
 */
export const syncYouTubeShortsJob = defineJob({
  payload: SyncYouTubeInput,
  run: (ctx) => syncYouTubeShorts(ctx),
});

export const jobHandlers = {
  hello: helloJob,
  "ingest-source": ingestSourceJob,
  "generate-ideas": generateIdeasJob,
  "generate-content": generateContentJob,
  "regenerate-field": regenerateFieldJob,
  "regenerate-visuals": regenerateVisualsJob,
  "generate-visual-assets": generateVisualAssetsJob,
  "render-carousel": renderCarouselJob,
  "import-library-photo": importLibraryPhotoJob,
  "run-visual-qa": runVisualQaJob,
  "extract-knowledge-batch": extractKnowledgeBatchJob,
  "embed-knowledge-items": embedKnowledgeItemsJob,
  "import-historical-posts": importHistoricalPostsJob,
  "annotate-historical-posts": annotateHistoricalPostsJob,
  "transcribe-pages": transcribePagesJob,
  "refresh-instagram-tokens": refreshInstagramTokensJob,
  "check-account-health": checkAccountHealthJob,
  "collect-insights": collectInsightsJob,
  "collect-account-insights": collectAccountInsightsJob,
  "import-attribution-csv": importAttributionCsvJob,
  "build-performance-summary": buildPerformanceSummaryJob,
  "check-ai-budget": checkAiBudgetJob,
  "publish-dispatcher": publishDispatcherJob,
  "publish-content": publishContentJob,
  "generate-reel": generateReelJob,
  "sync-youtube-shorts": syncYouTubeShortsJob,
};

type JobHandlers = typeof jobHandlers;

declare module "./core/job-runner" {
  interface JobRegistry extends JobHandlers {}
}
