# 06 · Background jobs

Spec §23.1 item 6 (§23 item 5). All jobs are Trigger.dev tasks (D-05) in `jobs/src`. Each task is a thin wrapper: parse payload (Zod) → build job context → call one service from `@rc/modules/job-handlers` → classify errors. The same handlers run in-process with `InlineJobRunner` for tests and local dev (D-25).

## 6.1 Common rules
- **Payloads** are small (IDs + options), validated with Zod, versioned by adding optional fields only.
- **Error classes** (`@rc/lib/errors`): `TransientError` → rethrow (Trigger.dev retries). `PermanentError` / `ValidationError` / `InvalidStateError` / `RightsBlockedError` → wrap in `AbortTaskRunError` (no retry). Unknown errors → retry up to the task's `maxAttempts`, then mark the domain entity FAILED with the error.
- **Default retry**: `maxAttempts 3, factor 2, minTimeoutInMs 5_000, maxTimeoutInMs 300_000, randomize true`.
- **Idempotency — three layers.**
  1. Trigger.dev idempotency key, always created with `idempotencyKeys.create(key, { scope: 'global' })` (raw strings default to run scope since v4.3.1 ⚠ V-17).
  2. Database: conditional status transitions + unique constraints (a second run finds nothing to do).
  3. External side effects: persisted external IDs (Instagram container IDs) are reused, never recreated blindly.
- **Visible failure.** Every job writes its outcome to the domain row (`processing_status`, `variant.status/flags/last_error`, `render.status`, `publication.status/last_error`) and to `audit_events`. The UI shows it; nobody needs the Trigger.dev dashboard to see that something failed.
- **Queues** (`jobs/src/queues.ts`): `llm` (concurrency 4), `images` (3), `render` (2), `instagram-publish` (1 per `concurrencyKey = socialAccountId`), `instagram-read` (2), `default` (5).
- **Machines** ⚠ V-17: default `small-1x`; `render-carousel` and `ingest-source` `medium-1x` (Chromium, large PDFs).
- **Alerts**: Trigger.dev alert channel (email or Slack) for failed runs of `publish-content`, `ingest-source`, `refresh-instagram-tokens`, `collect-insights`.
- **Logging**: `logger` from the job context (pino JSON) with `runId`, `taskId`, entity IDs; secrets redacted (12 §12.3).

## 6.2 Job catalog

| # | Task id | Trigger | Payload | Queue / machine | Idempotency | Retries | Priority |
|---|---|---|---|---|---|---|---|
| J1 | `ingest-source` | `completeSourceUpload`, `createTextSource`, `reprocessSource` | `{ sourceAssetId, attempt }` | default / medium-1x, maxDuration 60 min | key `ingest:{id}:{attempt}`; status must be QUEUED | 2 | P0 |
| J2 | `extract-knowledge-batch` | J1 (`batchTriggerAndWait`) | `{ batchId }` | llm, maxDuration 20 min | batch row status (skip SUCCEEDED); cards unique `(batch, ordinal)` | 3 | P0 |
| J3 | `embed-knowledge-items` | card create/edit/approve; model change | `{ knowledgeItemIds[] }` | default | skip if `embedding_hash` = hash(content) | 3 | P0 |
| J4 | `generate-ideas` | `generateIdeas` | `{ requestId, count, focus?, note? }` | llm | key `ideas:{requestId}` | 2 | P0 |
| J5 | `generate-content` | `generateVariants`, `regenerateVariant` | `{ masterIdeaId, variantIds[], pipelineRunId, instruction? }` | llm, maxDuration 30 min | key `gen:{pipelineRunId}`; resume via `pipeline_state` | 2 | P0 |
| J6 | `regenerate-field` | `regenerateVariantField` | `{ variantId, field, instruction?, reasonCode?, requestId, lockVersion }` | llm | key `regen:{requestId}`; lock version checked on write | 2 | P0 |
| J7 | `generate-visual-assets` | end of J5; visual regeneration | `{ variantId, slots?: {slideId, slot}[] }` | images | unique `(variant, slide, slot, prompt_hash)` | 3 | P0 |
| J8 | `render-carousel` | after J7; after text edits (debounced); `triggerRender` | `{ variantId }` | render / medium-1x, maxDuration 10 min | unique `(variant, input_hash)`; key `render:{variantId}:{inputHash}` | 2 | P0 |
| J9 | `publish-dispatcher` | cron `* * * * *` | – | default | `FOR UPDATE SKIP LOCKED` claim; SCHEDULED → QUEUED | 0 (next tick) | P0 |
| J10 | `publish-content` | J9; `schedulePublication(IMMEDIATE)`; `retryPublication` | `{ publicationId }` | instagram-publish, concurrencyKey = account | key = `publications.idempotency_key`; persisted step + container ids | 5 (30 s → 10 min) | P0 |
| J11 | `collect-insights` | cron hourly (minute 7) + `collectMetricsNow` | `{ publicationId?, slot? }` | instagram-read | unique `(publication, slot)`, `ON CONFLICT DO NOTHING` | 3 | P0 |
| J12 | `collect-account-insights` | cron daily 02:17 UTC | `{ socialAccountId? }` | instagram-read | unique `(account, metric_date)` upsert | 3 | P0 |
| J13 | `refresh-instagram-tokens` | cron daily 03:13 UTC | – | instagram-read | per account: skip if refreshed < 24 h ago | 3 | P0 |
| J14 | `check-account-health` | cron every 6 h; action | `{ socialAccountId? }` | instagram-read | read-only | 2 | P0 |
| J15 | `build-performance-summary` | cron weekly Mon 04:11 UTC; action; before J4 if latest summary > 7 days old | `{ marketId?, windowDays }` | default | key `summary:{market}:{windowEnd}` | 2 | P1 |
| J16 | `import-historical-posts` | `importHistoricalPosts` | `{ sourceAssetId }` | default | upsert on `(platform, external_id)` | 2 | P1 |
| J17 | `annotate-historical-posts` | after J16 (optional) | `{ postIds[] }` | llm | skip HUMAN_CONFIRMED | 2 | P1 |
| J18 | `import-attribution-csv` | `importAttributionCsv` | `{ fileKey, mapping }` | default | upsert on `(source, external_ref)` | 2 | P1 |
| J19 | `transcribe-pages` | J1 when pages have no text layer | `{ sourceAssetId, pages[] }` | llm | skip pages with `transcribed = true` | 2 | P1 |
| J20 | `cleanup-storage` | cron daily | – | default | – | 1 | P2 |

Cron minutes are spread (not :00) to avoid platform peaks.

## 6.3 Job details

### J1 `ingest-source`
1. Load asset; require status QUEUED; set PROCESSING (conditional update).
2. Rights gate: `aiProcessing` must be ALLOWED → else BLOCKED + `RightsBlockedError` (abort).
3. Stream the object from R2 to a temp file. Compute SHA-256; if another active asset has the same checksum → FAILED `DUPLICATE_SOURCE` (with link).
4. Sniff the real type (`file-type`), check size and page limits (07 §7.2.1) → FAILED with a clear code if not allowed.
5. Parse into pages (PDF / DOCX / text / transcript parsers) and write `source_pages` for this attempt in one transaction (delete rows of older attempts).
6. P1: chunk + embed into `source_chunks`; trigger J19 for pages without a text layer.
7. Plan extraction batches (07 §7.2.3) → insert `knowledge_extraction_batches`.
8. `batchTriggerAndWait` J2 for all batches (waiting does not use compute).
9. Finalize: count cards; run dedupe suggestions (07 §7.2.6); status READY if ≥ 1 batch succeeded (failed batches listed in `processing_progress`), else FAILED; audit `source.processed`.
- **Failure**: status FAILED + `processing_error`; the UI offers "Reprocess".

### J2 `extract-knowledge-batch`
1. Load batch; skip if SUCCEEDED; set RUNNING.
2. Mode PDF_NATIVE: cut pages `page_start..page_end` into a sub-PDF with `pdf-lib`; send as a document block. Mode TEXT: send page texts wrapped as `<page n="…">…</page>`.
3. `runStage('knowledge-extractor')` → validated cards.
4. For each card: verify the quote against page text (07 §7.2.4), set flags, insert with `(extraction_batch_id, ordinal)` (conflict → skip).
5. Move cards EXTRACTED → NEEDS_REVIEW after checks; trigger J3 for them; batch SUCCEEDED with `cards_created`.
- **Failure**: PDF call error after retries → one fallback attempt in TEXT mode (if page text exists) → else batch FAILED (the source can still finish READY).

### J5 `generate-content`
1. Load idea (must be ACCEPTED) and variants; transition each variant (DRAFT | READY_FOR_REVIEW | CHANGES_REQUESTED) → GENERATING. Variants already GENERATING with another `pipelineRunId` → abort (`InvalidStateError`).
2. Run the pipeline (07 §7.6). After each stage, store the stage output and `generation_runs` id in `pipeline_state` and the variant columns. A retried run skips completed stages.
3. End: variant → READY_FOR_REVIEW with critic report, flags, `generation_version`, `generation_config`; trigger J7 per variant.
- **Failure**: variant → DRAFT + `GENERATION_FAILED` + `last_error`; the idea page shows "Retry".

### J8 `render-carousel`
1. Compute `input_hash` from slides, asset ids, theme variant, template versions. If a READY render with this hash exists → set `current_render_id` and stop.
2. Glyph pre-check (08 §8.6); missing glyph → render FAILED + flag `MISSING_GLYPH` (no Chromium launch).
3. Launch Chromium once; for each slide: HTML → fonts ready → fit text → overflow check → PNG → `sharp` JPEG → R2 → `rendered_slides`.
4. QA report; READY → `current_render_id`; flags `TEXT_OVERFLOW` / `RENDER_FAILED` updated (cleared when fixed).
- **Debounce**: text edits trigger J8 with `delay: 10s` and key `render:{variantId}:{inputHash}`; several quick edits produce one render per distinct content.

### J9 `publish-dispatcher` + J10 `publish-content`
Full state machine in 09 §9.4. Summary:
- J9 every minute: if `publishing.enabled` and `INSTAGRAM_PUBLISH_MODE ≠ off` → `select … where status = 'SCHEDULED' and scheduled_at <= now() order by scheduled_at limit 10 for update skip locked` → set QUEUED → trigger J10 with the publication's idempotency key. It also finds publications stuck in QUEUED/IN_PROGRESS for > 30 min without an active run and re-triggers them (J10 resumes from `step`).
- J10: safeguards → CREATE_CHILDREN → CREATE_PARENT → WAIT_READY (poll with `wait.for`, max ~10 min) → PUBLISH → FINALIZE. Each step persists before the next call.
- **Failure**: transient (rate limit, 5xx, network, media fetch timeout) → retry with backoff; auth (code 190) → account NEEDS_REAUTH + publication FAILED; invalid media/params → FAILED with explanation; ambiguous publish result → reconciliation (09 §9.4.3) before any new publish call.

### J11 `collect-insights`
1. Compute due slots: for PUBLISHED publications, slot time = `published_at + offset` (H2 = 2 h, D1 = 24 h, D3 = 72 h, D7 = 168 h, D28 = 672 h) with no snapshot yet and `now ≥ slot time`. Take ≤ 50 per run, oldest first.
2. Fetch media insights (metric list per media type, 11 §11.2); store the snapshot with the real `media_age_hours`.
3. A slot missed by more than its tolerance (H2: 3 h, D1: 12 h, D3: 24 h, D7: 48 h, D28: 7 d) is still stored, with the true age; analysis uses age, not only the slot name.
- **Failure**: per-publication errors are isolated (one failing post does not block others) and written to `integration_events`.

### J13 `refresh-instagram-tokens`
For each ACTIVE account whose token was refreshed more than 24 h ago and expires within 20 days (or was not refreshed for 7 days): call the refresh endpoint ⚠ V-03, re-encrypt, update expiry. Failure with code 190 → NEEDS_REAUTH, token_status INVALID, banner in the UI, `integration_events` ERROR. Tokens that expire within 7 days and could not be refreshed → EXPIRING.

## 6.4 Cron summary

| Schedule (UTC) | Task |
|---|---|
| every minute | `publish-dispatcher` |
| hourly at :07 | `collect-insights` |
| daily 02:17 | `collect-account-insights` |
| daily 03:13 | `refresh-instagram-tokens` |
| every 6 h at :23 | `check-account-health` |
| Monday 04:11 | `build-performance-summary` (P1) |
| daily 05:29 | `cleanup-storage` (P2) |

## 6.5 JobRunner interface

```ts
// modules/src/core/job-runner.ts
type JobName = keyof typeof jobHandlers;               // 'ingest-source' | 'generate-content' | …
interface JobRunner {
  trigger<N extends JobName>(name: N, payload: JobPayload<N>, opts?: {
    idempotencyKey?: string;        // always global scope in the Trigger.dev implementation
    delaySeconds?: number; concurrencyKey?: string; tags?: string[];
  }): Promise<{ runId: string }>;
}
// TriggerDevJobRunner → tasks.trigger(name, payload, { idempotencyKey: await idempotencyKeys.create(k, { scope: 'global' }), … })
// InlineJobRunner     → runs jobHandlers[name](jobCtx, payload) in-process (tests, E2E, `pnpm dev` without Trigger.dev)
```
Selected by env `JOBS_MODE=trigger|inline` (prod must be `trigger`; checked at startup).
