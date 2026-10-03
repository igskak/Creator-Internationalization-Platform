# Decision log

Record here: deviations from the plan, results of ⚠ verification items (V-xx), gate outcomes, prompt/model activations, and scope changes. Newest entry first. One entry per decision.

Template:
```
## YYYY-MM-DD · <short title> [<task or V-id>]
- Context: …
- Decision: …
- Evidence / links: …
- Impact on plan: <files/sections/tasks changed>
```

---

## 2026-10-03 · Knowledge Base list and review transitions; Russian interface foundation [M1-17]
- Context: M1-17 builds `/knowledge/cards` (10 §10.2). The owner chose layout A from three mockups (review queue) with the filters of B (counts per value), the interface in English, and asked to add Russian at once.
- Decision:
  - **Service `modules/src/knowledge/cards/`:** `listKnowledgeCards` (filters: statuses, categories, sources, flags (any of), language; case-insensitive search in title, claim and explanation with LIKE wildcards escaped; page size 50, at most 100; status counts and facet counts where each ignores its own filter so the choices stay visible; review order of 07 §7.2.8: verified quote, then manual cards, then unverified, then confidence, optional focus categories, newest source; `approvable` = cards of the whole list in NEEDS_REVIEW with a verified quote (or no quote) and no flags, the first 100 ids). 500 cards with facets list in well under a second in the test.
  - **Transitions (`transition.ts`), built here and reused by M1-18:** `transitionKnowledgeCard` — approve NEEDS_REVIEW → CHEF_APPROVED (chef, owner or system; title, claim and category filled; the quote verified, or `acceptUnverifiedQuote` with a note; writes a `knowledge_item_versions` snapshot of version N, sets `approved_version/by/at`, audit `knowledge.approved`, asks for the embedding); archive from NEEDS_REVIEW, EXTRACTED or CHEF_APPROVED with a reason (an approved card only by chef or owner; audit `knowledge.archived`); restore ARCHIVED → NEEDS_REVIEW (chef, owner; clears the reason; audit `knowledge.restored`). `bulkTransitionKnowledgeCards` (up to 100): same guards per card, plus for approval (07 §7.2.8) only cards with a verified quote and no flags; an unverified quote is skipped and never overridden in bulk; a card that cannot move is reported in `skipped` with a reason (`QUOTE_UNVERIFIED`, `HAS_FLAGS`, `INVALID_STATE`, `NOT_FOUND`, `MISSING_FIELDS`) and the rest still move; an editor's bulk approval is refused as a whole. Editing a card and the version bump stay with M1-18 (`updateKnowledgeCard`).
  - **Screen:** server page with the filters in the address (`?status=…&category=…&flag=…&source=…&language=…&q=…&page=…`, parsed and rebuilt by `lib/cards-query.ts`; unknown values are ignored). Status tabs with counts (default Needs review; Approved, Archived, All; Processing only while cards are being checked), search, four filter drop-downs with counts, rows with title, claim, source and page, category, flag badges and quote check mark with confidence, selection with a bulk bar (Approve, Archive with a reason dialog, Clear), "Approve verified (N)" for the whole list (100 per click), pagination, loading skeleton, empty states (no cards yet → Sources; nothing left to review; no match → clear filters). Approve buttons are disabled for editors with a hint. Results are reported as toasts, including why cards were skipped. Actions `transitionKnowledgeCard` and `bulkTransitionKnowledgeCards` in `server/actions/knowledge.ts`.
  - **Russian interface:** `apps/web/src/lib/i18n` — catalogs `en.ts` and `ru.ts` (the Russian type is derived from English, so a missing key fails the type check; a parity test also compares placeholders and plural forms), `format()` and `plural()` on `Intl.PluralRules` (Russian one/few/many), locale in the cookie `rc-locale` (not in the URL, so the routes of plan 10 stay), `I18nProvider` in the root layout, `<html lang>`, language switch in the user menu (server action `setLocale`). Translated now: the sidebar, the user menu and the whole Knowledge Base screen. Everything else is still English: new task **I18N-01** covers the settings forms, placeholders, errors, dates and the taxonomy labels (they come from the database). CLAUDE.md says new screens add both languages.
  - **Not done:** I could not look at the rendered screen: signing in needs a magic link (or the E2E test login, which would create a session in the real Supabase project), so the checks are the service tests, the type check and `pnpm build`. The owner checks `/knowledge/cards` on the dev database (81 real cards) before the task is ticked.
- Evidence / links: `modules/src/knowledge/cards/cards.test.ts` (21 cases), `apps/web/src/lib/cards-query.test.ts`, `apps/web/src/lib/i18n/i18n.test.ts`.
- Impact on plan: new task I18N-01; M1-18 reuses the transition service and adds editing; M1-17 stays open until the visual check.

## 2026-10-03 · Retrieval service [M1-19]
- Context: M1-19 asks for `candidatePool()`, `searchApproved()` and `getIdeaCards(ideaId)` (07 §7.9.1). The tables for ideas (`master_ideas`, `master_idea_knowledge`) come with M2-01, so what depends on them cannot be built yet.
- Decision: `modules/src/knowledge/retrieval/`.
  - **`candidatePool(ctx, options)`:** approved (`CHEF_APPROVED`) cards that have a vector, filtered by categories and language, newest approval first (at most 2,000 are considered); cards in `recentlyUsedIds` are left out unless that leaves fewer than `minPool` (40), in which case the exclusion is skipped and `exclusionApplied` says so; then at most 60 cards by MMR (λ 0.7, `mmr.ts`) over the vectors. `categoryWeights` multiply relevance per category (above 1 for a coverage gap, below 1 for an overused category; both inputs come from the idea stage and later from performance memory). Without a query the relevance of a card is its weight, so the first pick is the most relevant one and the rest are chosen for difference; ties go to the smaller id, so a call is repeatable. The digest is `{id, category, title, claim ≤ 200 characters cut at a word with "…", language, version}`. The "angles" focus filter is not applied: cards have no angle, ideas do.
  - **MMR cost:** the highest similarity to the picked set is updated after each pick, so choosing 60 of N cards costs 60 × N dot products instead of 60 × N × 60.
  - **`searchApproved(ctx, {query, limit, categories, language, minSimilarity})`:** embeds the query (purpose `query`), orders approved cards by cosine distance, returns digests with `similarity`; an empty query is a `ValidationError` before anything is embedded; limit 1–50.
  - **`getApprovedSnapshots(ctx, [{knowledgeItemId, version}])`:** the frozen text from `knowledge_item_versions`, whatever happened to the card since; `NotFoundError` lists missing versions. Resolving an idea's links is the new follow-up task **M2-06a** (`getIdeaCards(ideaId)` and the "PRIMARY in the last 30 days" lookup that feeds `recentlyUsedIds`), needing M2-01.
  - The 81 real cards are still NEEDS_REVIEW, so the pool is empty on the dev database until the chef approves cards (M1-17/M1-18).
- Evidence / links: `modules/src/knowledge/retrieval/retrieval.test.ts` (MMR clusters and weights; pool filters, diversity 3 topics × 30, exclusion and its fallback, category weights, only approved cards with vectors; search ranking, filters, floor, empty query; snapshots).
- Impact on plan: new task M2-06a; M2-06 builds the idea context from `candidatePool` and passes `recentlyUsedIds`.

## 2026-10-03 · First real embeddings: the 81 cards of the guide [M1-16]
- Context: with the owner's go-ahead, `AI_PROVIDER=live pnpm rc embed` embedded the 81 cards of «Не Вари. Проектируй. Крупы» with `text-embedding-3-large` (1536 dimensions) in the dev database; their text went to OpenAI.
- Result: 81 cards embedded, 0 already current, **0 duplicates suspected** at the 0.92 threshold. The closest pairs have cosine similarity 0.70–0.75 and are different concepts (risotto rice vs basmati "what it likes", formula 1 vs formula 2, "culinary engineering" vs "five variables"); nearly all of the 3,240 pairs lie between 0.3 and 0.6. All vectors carry `embedding_model = text-embedding-3-large`.
- Findings: the 81 cards are fine-grained but not redundant. The granularity question from the first ingestion (the chef's review load) is therefore about how many distinct points the extractor splits a page into, not about duplicates; dedupe at 0.92 has nothing to do on this guide. Real near-copies are expected only across sources (the same technique in two books), where the threshold stays as is until a pair shows it too strict or too loose.
- Decision: no change to the threshold or the prompt. Keep the vectors for M1-19 retrieval tests.
- Evidence / links: source `ac755636-d331-46ec-833d-da736aabd681` in the dev database.
- Impact on plan: none.

## 2026-10-03 · Card embeddings and duplicate suggestions [M1-16]
- Context: M1-16 gives cards vectors (for retrieval, M1-19) and suggests duplicates (07 §7.2.6).
- Decision: `modules/src/knowledge/embedding/`.
  - **Text and hash:** `cardEmbeddingText` = title, claim, explanation, procedure steps and mistakes (with why/fix) in the card's language; its SHA-256 is `embedding_hash`. `embedKnowledgeItems(ctx, ids)` skips a card when it has a vector, `embedding_model` equals the provider's model and the stored hash equals the hash of the current text; so unchanged cards cost nothing, an edited card is re-embedded, a model change re-embeds everything. Archived cards are ignored. Vectors are written 256 cards at a time.
  - **Duplicates:** `suggestDuplicates(ctx, ids)` compares each card with older (by `created_at`, ties by id), non-archived cards of the same language; cosine similarity ≥ 0.92 (`DUPLICATE_SIMILARITY`) → flag `DUPLICATE_SUSPECTED` and `duplicate_of_id` pointing at the closest older card. Of a pair exactly one card is flagged, the newer one, so an approved card is never marked as the copy of a fresh extraction. A card that no longer matches (its text changed) loses the flag and the pointer, other flags stay. Nothing is merged.
  - **Job J3 `embed-knowledge-items`** (`{ knowledgeItemIds? }`, up to 500): `embedAndSuggest` embeds the given cards, or every stale card (no vector, or another model) when no ids are given (backfill, re-embed after a model change), then suggests duplicates for the cards it embedded. Registered with a Trigger.dev task on the default queue. `requestEmbedding(ctx, ids)` is the hook for the services that create, edit or approve cards (M1-18, M1-20); it sets no idempotency key, because the job skips unchanged cards and a key would swallow a later edit.
  - **Ingestion:** after a source turns READY, `ingest-source` starts J3 for the cards of its batches. If that cannot be done (provider down, job runner error) the source stays READY, a warning is logged, and the backfill job catches up. This replaces the "dedupe suggestions" part of 06 J1 step 9 and the "trigger J3" in J2 step 5 with one trigger per source.
  - **Dev CLI:** `pnpm rc embed` runs the backfill and lists the suspected duplicates; `pnpm rc ingest` also prints how many cards have vectors and how many duplicates were suspected.
- Evidence / links: `modules/src/knowledge/embedding/embedding.test.ts` (text and hash; skip when current; edit and model change re-embed; archived and unknown ids; transient errors propagate; stale lookup; forced similar pair flags the newer card; same-instant pair flags one; the 0.92 threshold with crafted vectors 0.93 and 0.91; language and archive filters; flag kept, not duplicated, cleared; J3 with ids and as backfill), `ingest-source.test.ts` (vectors after READY and a duplicate pair flagged; READY when embeddings fail, backfill later).
- Impact on plan: M1-17 can filter by `DUPLICATE_SUSPECTED`; M1-18/M1-20 call `requestEmbedding`; M1-19 retrieval reads `embedding` for cards with `review_status = CHEF_APPROVED`. The 81 cards of the first real guide have no vectors yet: `pnpm rc embed` with live OpenAI keys sends their text to OpenAI, so it waits for the owner's go-ahead.

## 2026-10-03 · Embedding provider; V-19 (embeddings part) verified [M1-11, V-19]
- Context: M1-11 needs the OpenAI embeddings adapter and a fake. V-19 asked to check the model, `dimensions`, prices and data terms against OpenAI's current documentation (docs moved to developers.openai.com; fetched 2026-10-03).
- V-19 results (embeddings; the image part stays open for M3-03):
  - Models: `text-embedding-3-small` (1536 dims by default), `text-embedding-3-large` (3072 by default), `text-embedding-ada-002`. The `dimensions` parameter works on both v3 models; shortening keeps their quality (3-large at 256 dims beats ada-002 at 1536 on MTEB), so `text-embedding-3-large` with `dimensions: 1536` (D-09) stands. The documentation says to L2-normalize when you shorten vectors yourself; with the API parameter the vectors are used as returned, and pgvector's cosine distance (`<=>`) does not depend on length.
  - Limits of `POST /v1/embeddings`: 8,192 tokens per input, 300,000 tokens and 2,048 inputs per request, no empty string; `encoding_format` `float` (default) or `base64`; response `data[{index, embedding}]` and `usage.prompt_tokens`.
  - Price: $0.13 per 1M tokens for `text-embedding-3-large` ($0.02 for `-small`), standard only. The 81 cards of the first real guide are about 20k tokens, a fraction of a cent.
  - Data: API data is not used for training unless opted in; abuse-monitoring logs are kept up to 30 days; `/v1/embeddings` is eligible for zero data retention on request. The owner's vendor-terms review (Track B) can use this.
- Decision: `lib/src/providers/embeddings/`: `EmbeddingProvider` (07 §7.3), constants `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` (1536; a test checks it equals the schema constant), `createOpenAIEmbeddingProvider` (plain `fetch`, no vendor SDK: one endpoint; inputs split into requests of at most 2,048 texts and about 250,000 estimated tokens at 2 characters per token, the worst case for Cyrillic; empty text and texts over 32,000 characters are rejected before any request; retries 429, 5xx, 408, timeouts and network errors up to 3 times with `Retry-After` or backoff with jitter; 400/401/403/404 are `PermanentError`, exhausted retries `TransientError` (rate limited for 429); the response must have the right count and size; an `onUsage` hook reports billed tokens), `createFakeEmbeddingProvider` (deterministic unit vectors from a hash of the text; `similar` groups give nearly identical vectors, cosine about 0.998, for dedupe tests; records calls), `embedTexts()` (vector + model + SHA-256 of the text, `embeddingHash`; the model is compared separately, so a model change re-embeds), `createEmbeddingProvider(env.ai)`. `ServiceContext.embeddings` (default refuses) is wired in web, jobs and CLI.
- Evidence / links: `lib/src/providers/embeddings/openai.test.ts` (MSW: request shape with `dimensions`, order, batching 5000 → 2048 + 2048 + 904, token-based split, retries, error mapping, no key in messages), `fake.test.ts` (determinism, unit norm, orthogonality, similar groups), `modules/src/ai/ai.test.ts` (constants, disabled default).
- Impact on plan: M1-16 uses `embedTexts` and the fake's `similar` groups for the forced duplicate pair.

## 2026-10-03 · First real ingestion: guide «Не Вари. Проектируй. Крупы» [M1-15]
- Context: dev run of `pnpm rc ingest` on the real PDF (93 KB, 18 pages, text layer) with `AI_PROVIDER=live`, model `claude-opus-5-5`, dev Supabase database and R2. The migration `0002_knowledge` had not been applied to the dev database yet; the owner approved `pnpm db:migrate` and it ran first.
- Result: source READY. Two PDF_NATIVE batches (pages 1–15 and 16–18), both SUCCEEDED on the first attempt without a repair. **81 cards**, all NEEDS_REVIEW; **0 with an unverified quote**; 4 `SAFETY_SENSITIVE`; no `LOW_CONFIDENCE`. Model: 2 calls, 40,152 input and 28,446 output tokens, **$0.7465** (batch 1: $0.62, 168 s; batch 2: $0.12, 38 s). Page 1 (cover, 101 characters) skipped as FRONT_MATTER. Every content page produced between 1 and 13 cards, so no page of the content was left out.
- Findings:
  - The model followed the fidelity rules: every quote was found in the cited pages (score check passed for all 81), confidence 0.80–0.95 (average 0.88, 28 cards below 0.90), categories from the taxonomy (51 GRAINS_RICE_PASTA, 13 TECHNIQUES, 7 FOOD_SCIENCE, 5 SPICES_SEASONING, 2 EQUIPMENT, 2 STORAGE_SAFETY, 1 SAUCES_STOCKS).
  - 81 cards from 17 pages is about four times the 20 cards of the S-01 spike: the new prompt says "as many as the pages support". Expect near-duplicates and fine-grained cards (page 17 alone gave 13); M1-16 dedupe and the review queue order (07 §7.2.8) matter more now, and the chef's review load is the bottleneck (R-20): 81 cards for an 18-page guide. A per-batch target or a "merge closely related points" rule is a candidate for `v2` if Ihor and Sergey find the cards too granular.
  - 58 of 81 cards have an empty `explanation` (the source gives none, as the rule asks); ratios such as grain:water have no structured field and stay in `claim`/`procedure`; only 5 cards have timings and 1 a temperature.
  - A 15-page batch took 168 s, within the 20-minute task limit; whole-guide cost scales roughly $0.04 per page, so a 200-page book is about $8 and a 1,000-page one about $40.
- Decision: M1-15 done. The 81 cards stay in the dev database as the first real data for M1-17/M1-18. No change to prompt or checks yet; revisit granularity after the owners' review of the cards.
- Evidence / links: source id `ac755636-d331-46ec-833d-da736aabd681` in the dev database; `generation_runs` rows for the two batches.
- Impact on plan: none to scope; R-20 (chef review load) gets a concrete number.

## 2026-10-03 · Ingestion orchestrator `ingest-source` and reprocessing [M1-15]
- Context: M1-15 chains the earlier pieces into J1 (06 §6.3) and adds reprocessing (05 §5.3).
- Decision:
  - **`modules/src/knowledge/ingest-source.ts`:** `ingestSource(ctx, {sourceAssetId, attempt, mode})`. Skips (returns, no error) an archived source, a stale attempt (payload attempt ≠ the source's) and a READY/FAILED source; other states than QUEUED/PROCESSING are `InvalidStateError`. A retried run finds the source PROCESSING and resumes. Order: rights gate (`canProcessWithAI`; failing → status BLOCKED, audit `source.blocked`, throws `RightsBlockedError`, which the job runner does not retry) → QUEUED→PROCESSING → sniff → duplicate check (`DUPLICATE_SOURCE`, no checksum is stored on the duplicate) → store checksum and real size → parse by kind and extension (PDF, DOCX, `.md` with headings, `.srt`/`.vtt`, other text) → `savePages` → plan (`planPdfBatches` for PDFs, `planTextBatches` otherwise) → `insertBatches` → extraction → finalize. Temp files are always removed. `SourceRejectedError` ends the source as FAILED with `processing_error {code, message, details}` and audit `source.failed`; transient and unexpected errors leave PROCESSING and are rethrown.
  - **Waiting for batches:** `JobRunner` gained `triggerAndWaitAll(name, payloads)` → `{ok, output} | {ok:false, error}` per run. The Trigger.dev runner uses `batchTriggerAndWait` (only valid inside a task; the stub-tested wrapper is untested against the real service until the first Trigger run), the inline runner runs the payloads one after the other, the disabled runner refuses. Batches already SUCCEEDED or SKIPPED are not started again, so a resumed run only does the rest.
  - **Finalize:** counts come from the batch rows, not from run results. READY when at least one batch succeeded; `processing_progress` = `{stage: "DONE", pagesTotal, batchesTotal, batchesDone, cardsCreated, failedBatches[{batchIndex, pageStart, pageEnd, code}]}` (the Zod type got `failedBatches`), audit `source.processed`; otherwise FAILED `ALL_BATCHES_FAILED` with the failed batches in `details`. Dedupe suggestions (06 J1 step 9) move to M1-16 with the embeddings they need.
  - **`reprocessSource` (owner, editor):** only READY or FAILED, only with rights that allow AI processing. In one transaction: status → QUEUED with `processing_attempt + 1`, progress and error cleared (audit `source.reprocessed`); this attempt's unapproved cards (EXTRACTED, NEEDS_REVIEW, origin SOURCE_EXTRACTED) → ARCHIVED with `archive_reason = SUPERSEDED` (audit `knowledge.archived`); approved cards are untouched. Then `ingest-source` with key `ingest:{id}:{attempt}`. Modes: FULL parses the file again; KNOWLEDGE_ONLY keeps the page rows (moved to the new attempt, the file is not read) and re-plans and extracts; with no pages it falls back to FULL. Web action `reprocessSource` added.
  - **Job:** the `ingest-source` handler is the real one (payload gained `mode`, default FULL).
  - **Dev CLI:** `pnpm rc ingest <file> --ai-allowed [--type] [--language] [--title]` uploads a local file, runs the job in-process and prints status, pages, cards (unverified, safety-sensitive), model calls, tokens and cost. `--ai-allowed` is required because the command sets `aiProcessing = ALLOWED` and the file goes to the model. The CLI context now has an inline job runner. Documented in CLAUDE.md.
  - **Known gap:** if every Trigger.dev retry of `ingest-source` fails with a transient error, the source stays PROCESSING; a failure hook that marks it FAILED belongs with the observability work (H tasks).
- Evidence / links: `modules/src/knowledge/ingest-source.test.ts` (12 end-to-end cases through the inline runner: Markdown and PDF happy paths, BLOCKED then unblocked by the owner, rights withdrawn, duplicate, wrong type, partial READY, all batches failed, skips and resume, reprocess FULL and KNOWLEDGE_ONLY, reprocess guards), `core/job-runner.test.ts` (`triggerAndWaitAll`), `cli-commands.test.ts` (`ingest`).
- Impact on plan: M1-15 stays open until the dev run on a real PDF; M1-16 adds embeddings and dedupe after READY; the M1-17 UI reads `processing_progress`.

## 2026-10-03 · Quote and number verification, review flags [M1-14]; M1-12 closed
- Context: M1-14 verifies the model's quotes and structured numbers by code (07 §7.2.4) and sets the safety flag (07 §7.2.7). Ihor reviewed the extractor prompt text on 2026-10-03 and approved it, so M1-12 is ticked.
- Decision: `modules/src/knowledge/extraction/`.
  - **`verify-quote.ts`:** `normalizeForMatch` (NFKC, lower case, `ё → е`, one kind of quotes, apostrophes and dashes, soft hyphens and zero-width characters removed, spaces collapsed; a hyphen at a line end is read both ways, joined and kept, because "что-\nто" is a real hyphen and "кас-\nтрюля" is not). `verifyQuote` searches the cited pages ± 1 (also across a page boundary): an exact substring scores 1; otherwise the best token-level window (lengths 0.8n, n, 1.2n; edge punctuation ignored, so a punctuation-only change still scores 1) with score = 1 − edit distance / length; verified at ≥ 0.90. Windows that share fewer than 40 % of the quote's words are skipped by a prefix-sum check, so scores below ~0.4 are not exact (the note then shows a low number); 3 pages × 800 words with a missing 40-word quote runs in well under 2 s.
  - **Numbers:** every `temperatures[].value` and `timings[].value` / `valueMax` must be stated on the cited pages (not ± 1): as digits (decimal comma, signs, ranges like 10–15), or as a number word in Russian, Spanish or English (двух, dos, two; 1–10, 12, 15, 20, 30, 60); the value 1 is also accepted when the unit is named in the singular (сутки, hour). Missing → flag `LOW_CONFIDENCE` with the note "number not found in source: …". Spelled-out numbers were added because without them correct cards ("двух часов") would be flagged. Fractions and words like "полчаса" are not understood and go to review.
  - **`safety.ts` / `assess.ts`:** `assessCard` returns `quoteVerified`, `matchScore`, flags and notes. Flags: `QUOTE_UNVERIFIED` (score < 0.90), `LOW_CONFIDENCE` (a missing number or model confidence < 0.6; exactly 0.6 passes), `SAFETY_SENSITIVE` (the model's flag, a CORE temperature target, or a keyword rule: raw or undercooked meat, fish or eggs; core temperature; canning, preserving, fermenting; botulism and other pathogens; allergens; alcohol, in RU/ES/EN). Keyword rules only raise the flag, they never lower the model's; the note "Keyword rule: …" is stored in `safety_notes` when the model gave no reason. Storing cooked food is not on the plan's keyword list; such cards rely on the model's flag. Regexes use `\p{L}`, not `\w`/`\b`, which do not see Cyrillic.
  - **`extractBatch`:** looks up evidence pages (batch range ± 1), assesses each new card, stores `source_reference.quoteVerified`, `matchScore` and the note, `review_flags`, `safety_sensitive`, `safety_notes`, then moves the cards it just inserted EXTRACTED → NEEDS_REVIEW through `transition` (statusKey `reviewStatus`, audit `knowledge.needs_review`). Cards left by an interrupted earlier run are not touched. Approval of a `QUOTE_UNVERIFIED` card needing an override with a note stays with M1-18.
- Evidence / links: `modules/src/knowledge/extraction/verify.test.ts` (normalization, table of quote cases incl. hyphenation, soft hyphen, ё/е, quotes, fuzzy threshold 0.92 vs 0.83, neighbour pages; numbers; safety keywords positive and negative per language; assessment), `extraction.test.ts` (flags and review queue through the batch).
- Impact on plan: DUPLICATE_SUSPECTED is set by M1-16; M1-17 default order (07 §7.2.8) can use `quoteVerified`, `confidence` and flags as stored here.

## 2026-10-03 · Extraction batches [M1-13]
- Context: M1-13 plans page-range batches and runs the extractor per batch (06 J2, 07 §7.2.3).
- Decision: `modules/src/knowledge/extraction/`.
  - **`plan.ts`:** `planTextBatches` packs pages up to ~12k tokens (3 characters per token for ru/uk/bg/be/sr/mk, 4 otherwise; an oversized page goes alone). `planPdfBatches` cuts 15-page PDF_NATIVE batches; a sub-PDF must stay under 25 MB, and since `pdf-lib` copies only the pages' resources, a file under 25 MB needs no measuring, otherwise each range is measured (`pdfMeasurer`) and halved until it fits; a single page still too large becomes a TEXT batch. `cutPdf` makes the sub-PDF.
  - **`batch.ts`:** `insertBatches` (PENDING rows, `onConflictDoNothing` on (source, attempt, index)) and `extractBatch(ctx, {batchId})` = J2: SUCCEEDED/SKIPPED batches return at once; the AI rights gate runs before anything else; a batch whose attempt is not the source's current one becomes SKIPPED (`STALE_ATTEMPT`); then RUNNING, page rows of the attempt, taxonomy from `taxonomy_terms` (`taxonomy.ts`), `runStage('KNOWLEDGE_EXTRACTION')` with `validateExtraction`, cards inserted by `(batch, ordinal)` with conflicts ignored (so a half-done batch finishes), `cardsCreated` counted from the table, batch SUCCEEDED with the last run id.
  - **Fallback:** in PDF_NATIVE mode an API-rejected PDF (`PermanentError`), a sub-PDF over the guard, INVALID_OUTPUT after the repair, or a refusal triggers one TEXT attempt (the batch's `mode` becomes TEXT); no page text → batch FAILED (`PDF_FAILED_NO_TEXT`), the source can still finish READY. A transient error is not a fallback case: the batch is marked FAILED (a FAILED batch may run again) and the error is rethrown for the job runner to retry. Permanent failures are returned as `FAILED` in the outcome, with the reason, issues and refusal category in `knowledge_extraction_batches.error`; the job does not throw for them.
  - **`validate.ts`:** blocking checks for the repair: empty title/claim, missing or over-400-character quote, confidence outside 0–1, pages outside the batch range (or end before start), `safetySensitive` without reason, and the JSON shapes (`Timing` valueMax ≥ value etc.); skipped pages out of range are MINOR.
  - **Cards:** stored as `EXTRACTED`, `origin = SOURCE_EXTRACTED`, language of the source, `source_reference` with `quoteVerified: false`, flag `SAFETY_SENSITIVE` when the model says so. Quote and number verification and the other flags are M1-14; the move to NEEDS_REVIEW is M1-15; embeddings M1-16.
  - **Job:** `extract-knowledge-batch` is registered (`{ batchId }`) with a Trigger.dev task on the `llm` queue, 20 minutes.
  - Each batch loads the whole source PDF from storage to cut its pages (up to 200 MB per batch on the worker); revisit if memory or time shows up as a problem (the alternative is to store sub-PDFs at planning time).
  - `@rc/prompts` exposes the extractor fixtures as `@rc/prompts/fixtures/knowledge-extractor` for tests.
- Evidence / links: `modules/src/knowledge/extraction/extraction.test.ts` (planning, validators, success, rerun skip, half-done batch, PDF failure → TEXT, invalid and refused → TEXT, size guard, no-text failure, repair, transient retry, rights gate, stale attempt).
- Impact on plan: M1-14 plugs quote and number verification into `extractBatch` before the insert; M1-15 plans batches with `planPdfBatches`/`planTextBatches` + `insertBatches` and waits for `extract-knowledge-batch`.

## 2026-10-03 · Knowledge extractor prompt v1 [M1-12]
- Context: M1-12 needs the first real prompt, a taxonomy-dependent output schema, and fixtures. The S-01 spike showed models add scenes, intensifiers ("always", "the most common mistake") and facts the source lacks, and that verbatim quotes can be verified by code.
- Decision:
  - `prompts/src/knowledge-extractor/`: `schema.ts` (`ExtractorInput`, `ExtractorOutput`, `KnowledgeCardDraft`, `extractorOutputFor`), `v1.ts` (`knowledge-extractor@1`, registered in `promptRegistry`), `fixtures.ts` (4 synthetic Russian pages: table of contents, buckwheat, rice storage, a course advertisement; a reference output), `v1.test.ts` with a file snapshot of the rendered prompt.
  - **Per-call output schema:** `PromptDefinition` gained an optional `outputFor(input)`; `runStage` parses the input once, renders, and sends and checks against `outputFor(input)` when present (`output` stays the structural schema). The extractor builds category and subcategory enums from the active taxonomy, so the JSON Schema sent to the model lists exactly those codes. Without subcategories the field is free text. Like `render`, `outputFor` is not part of the hash: a behavior change means a new version.
  - **Input:** source meta, active taxonomy terms, mode (`PDF_NATIVE` with an attached PDF whose first page is `pageStart`, or `TEXT` with `<page n section>` elements), page range. Everything from sources goes through the escaping helpers; the system prompt says tagged and attached content is data, not instructions.
  - **Rules (S-01 findings built in):** extract only what the pages state; no strengthening or generalization; explanation is the author's, empty if the source gives none; source language, no translation; numbers and units copied exactly, never converted; a verbatim quote of at most 400 characters from one place; source page numbers (not positions in the sub-PDF); skip front matter, contents, advertising, listed in `skippedPages` with an enum reason; confidence below 0.6 when unclear; `safetySensitive` with a reason for raw or undercooked food, core temperatures, storing cooked food, preserving, allergens, alcohol; never soften safety statements. Schema limits that JSON Schema cannot carry (quote length, confidence 0–1, page range, `safetyReason` when safety-sensitive) are for the M1-13 validators.
  - **Evals:** expected-card notes and "must not happen" list in `evals/datasets/knowledge-extractor/README.md` for the M2-16 harness.
  - **Status:** v1 is unreleased until the first real extraction run, so edits after Ihor's review go into `v1.ts` (and the snapshot); from the first live use on real sources a change needs `v2.ts` and an eval. The checkbox in 15 stays open until that review.
  - Fixed on the way: a task sentence rendered `<pages>` escaped (`&lt;pages&gt;`) because plain strings are escaped; the sentence now says "the pages section".
- Evidence / links: `prompts/src/knowledge-extractor/v1.test.ts` (snapshot, PDF mode, injection through page text, input checks, fixture output parses with both schemas, quotes verbatim on their pages, taxonomy enums in the JSON Schema), `modules/src/ai/ai.test.ts` (`outputFor` through `runStage`; stage config points at the registered prompt).
- Impact on plan: `outputFor` added to the M1-09 prompt API; M1-13 uses `knowledgeExtractor.ExtractorInput`, builds the taxonomy from `taxonomy_terms` and adds the validators above.

## 2026-10-03 · runStage and generation logging; default model Claude Opus 5.5 [M1-10]
- Context: M1-10 builds `runStage()`; the owner decided on 2026-10-03 that the default model is Claude Opus 5.5 (recommendation from the M1-08 entry accepted).
- Decision:
  - **Model:** `claude-opus-5-5` for every stage (`DEFAULT_MODEL` in `modules/src/ai/config.ts`). D-08 in 01 §1 and 16 §16.5, CLAUDE.md, 01 §1.5 (price note: $4 / $20 per million tokens), 07 §7.4 and §7.6.1, README and the M1-10 entry now say `claude-opus-5-5`. It does not allow disabled thinking and its default effort is `medium`, so `STAGE_CONFIG` sets effort explicitly for all 12 stages (extraction medium + streaming + 32k; ideas, adapter, writer, critic, regenerator, judge high; visual director and visual QA medium; annotation, gloss, transcription low).
  - **`modules/src/ai/`:** `config.ts` (stage → prompt id + active version, model, effort, maxTokens, stream), `version.ts` (`PIPELINE_VERSION` 1.0.0, `generationVersion()` → `p1.0.0`), `cost.ts` (`MODEL_PRICES`, `computeCostUsd`: per million tokens incl. cache reads and 5-minute cache writes at 1.25 × input; unknown model → null, never a guess; cache-read prices of Opus 5 / 4.8 are assumed 0.1 × input), `run-stage.ts`.
  - **`runStage(ctx, {stage, input, attachments?, validate?, inputRefs?, sourceAssetId?, prompt?, config?})`:** validates input with the prompt's schema (bad input → `ValidationError`, nothing sent or logged), calls `ctx.llm`, checks the answer with the prompt's Zod schema and the optional domain validator. Only BLOCKER issues trigger the repair; MAJOR and MINOR are returned in `issues` (reviewer flags). One repair = a new single-turn request: the same content plus `<previous_output>` and `<validation_issues>` as escaped data, no history. Statuses: `SUCCEEDED`, `REPAIRED` (repair run), `INVALID_OUTPUT` (invalid after the repair, or truncated twice: no repair then), `REFUSED` (also when the repair is refused; no retry, category in `error.details`). Provider errors write a `FAILED` row and are rethrown (transient errors retry through the job runner). A throwing validator still leaves its run logged.
  - **`generation_runs` rows:** one per model call, written once the verdict is known: prompt id/version/hash, provider, the model that answered (after a refusal fallback it differs from the configured one, and `params.fallbackRan` is set), params, request without binary documents (PDF/image replaced by size and SHA-256), input refs, input hash (`llmInputHash`), output (data, or `{rawText}` when invalid), status, validation errors, repair attempts, stop reason, usage, cost, latency, error, parent run (repair → first run), `trigger_run_id` for JOB actors, source asset.
  - **Wiring:** `ServiceContext.llm` (default refuses every call) set in web, jobs and CLI from `env.ai` through `createLlmProvider` (live → Anthropic adapter, fake → a fake without fixtures). `ValidationIssue` Zod type added to `db/src/json/validation.ts` (it was on the M2-01 list; M2-01 should reuse it). `GenerationParams` gained optional `fallbackRan` and `retriedForMaxTokens`.
  - **Module rules (02 §2.2):** `.dependency-cruiser.cjs` now lets `knowledge`, `localization` and `visuals` import `ai`; they were treated as leaf domains, which contradicted the component table and would have blocked M1-13. `@rc/modules` depends on `@rc/prompts`.
- Evidence / links: `modules/src/ai/ai.test.ts` (valid, repaired, invalid twice, refusal, truncation, provider errors, validator issues, cost, attachments, job and source ids, stage mismatch).
- Impact on plan: model references in 01, 07, 16, README, CLAUDE.md changed to `claude-opus-5-5`; the active prompt versions in `STAGE_CONFIG` point at prompts that later tasks register (M1-12 first).

## 2026-10-03 · LLM provider interface and Anthropic adapter; V-18 verified [M1-08, V-18]
- Context: M1-08 requires the `claude-api` skill and a check of V-18 against current Anthropic documentation (skill content cached 2026-09-25, SDK `@anthropic-ai/sdk` 0.131.0 read from its type definitions).
- V-18 results:
  - Model ids: `claude-opus-5-5` is the current Opus and the skill's default ($4 / $20 per MTok, 1M context, 128K output); `claude-opus-5` ($5 / $25) is still served. CLAUDE.md and D-08 say `claude-opus-5`; the S-01 spike ran `claude-opus-5-5`. The adapter takes the model from the request, so the choice is made in `modules/src/ai/config.ts` (M1-10). Recommendation: switch the default to `claude-opus-5-5` (cheaper, same surface); needs the owner's confirmation. Its default effort is `medium` (Opus 5: `high`), so every stage must set effort explicitly.
  - Thinking: it cannot be disabled on Opus 5.5 (`{type: "disabled"}` and `budget_tokens` both 400). The adapter always sends `thinking: {type: "adaptive"}`. `temperature`, `top_p`, `top_k` are rejected, so none is sent. Forced `tool_choice` is also a 400 (we use no tools).
  - Structured outputs: `output_config.format` with `zodOutputFormat(schema)` from `@anthropic-ai/sdk/helpers/zod`; `output_config.effort` for depth. Citations are incompatible with structured outputs (400), so none are enabled.
  - PDF: base64 `document` blocks, 32 MB per request. Page limit 600 (100 on 200k-context models); our batches are 15 pages.
  - Refusal: HTTP 200 with `stop_reason: "refusal"` and `stop_details.category`. Server-side fallback is opt-in: `fallbacks: "default"` with beta `server-side-fallback-2026-07-01` (Claude API only, rejected on Batches). The adapter sends it by default (`fallback: false` turns it off) and reports `fallbackRan` and the model that answered.
- Decision: `lib/src/providers/llm/` — `types.ts` (07 §7.3, plus `refusal`, `validationError`, `fallbackRan`, `retriedForMaxTokens`), `anthropic.ts`, `fake.ts`, `hash.ts` (`llmInputHash`, for `generation_runs.input_hash` and fixture keys). The adapter uses `client.beta.messages` (fallbacks live there), `create` or `stream().finalMessage()` per `stream`, and validates the answer text with the Zod schema itself instead of `messages.parse`, so both paths behave the same and an invalid answer returns `data: null` with a precise message for the repair prompt instead of throwing. `max_tokens` → one retry with the limit doubled (cap 128K), usage summed; a second truncation returns `data: null`. Errors: 429 → `TransientError` (rate limited, `retry-after`), 5xx/408/409/529/network → `TransientError`, other 4xx → `PermanentError`; SDK `maxRetries` 3, timeout 10 min. `FakeLLMProvider` answers from fixtures keyed `promptId:inputHash` or from a handler that can simulate refusal, truncation, bad output and errors, and records calls. `createStorage`-style factory from `env.ai` is left to M1-10 (`runStage` owns provider wiring).
  - Not covered by the contract tests: the real API's handling of the schema constraints (the SDK strips unsupported ones client-side; our validators keep length limits, 07 §7.8) and cache-read counts on a second call (needs a live run, planned with the first real extraction).
- Evidence / links: `lib/src/providers/llm/anthropic.test.ts` (MSW: no temperature, `output_config`, document block, cache markers, fallback header, max_tokens retry, refusal, streaming, error mapping, no key in messages), `fake.test.ts`.
- Impact on plan: new dependencies `@anthropic-ai/sdk` and dev `msw` in `@rc/lib`; V-18 done.

## 2026-10-03 · Prompts package foundation [M1-09]
- Context: 07 §7.5 defines `definePrompt`, the registry and the hash as "SHA-256 of id, version, system texts and the render template".
- Decision: `prompts/src/` has `define.ts` (`definePrompt` validates id kebab-case, integer version ≥ 1, stage from the `generation_stage` list, non-empty system blocks, maxTokens, changelog; returns a frozen prompt with `key` = `id@version` and `hash`; `renderPrompt` validates input with the Zod schema first; `renderSnapshot` returns system + user text with key and short hash for snapshot tests), `registry.ts` (`createRegistry`: get / has / versions / latest / list, duplicate keys throw), `xml.ts` (`section`, `renderSections`, `raw`, `escapeText`, `escapeAttr`) and `index.ts` (`promptRegistry`, empty until the prompt tasks add their `vN.ts`).
  - The hash covers id, version, system blocks (text and cache hint) and an explicit `renderTemplate` string, not the render function's source: `Function.toString()` changes when a bundler minifies, which would give web and jobs different `prompt_hash` values for the same prompt. A change to the rendered structure must therefore change `renderTemplate` and the version; `renderSnapshot` tests catch a render change that forgot to.
  - Escaping: `&`, `<`, `>` in all data; `"`, line breaks and tabs also in attributes; XML-invalid control characters are dropped; tag and attribute names must be lower snake case. Nested sections are passed as `Raw` so they are not escaped twice.
  - Active versions and `PIPELINE_VERSION` stay in `modules/src/ai/` (M1-10); the registry only knows what exists.
  - `@rc/prompts` now depends on `zod` and `node:crypto` (no workspace dependency, as in 03 §3.4).
- Evidence / links: `prompts/src/index.test.ts` (registry lookup, stable and pinned hash checked against openssl, escaping of `<` and `&`, injection attempt through data and attribute).
- Impact on plan: prompt tasks (M1-12, M2-06, M2-09, M2-10, M2-12, M3-02) fill `renderTemplate` and register in `prompts/src/index.ts`.

## 2026-10-03 · DOCX, text and transcript parsers [M1-07]
- Context: M1-07 turns non-paginated sources into pseudo-pages (07 §7.2.2) with `section_path` and, for transcripts, a time locator.
- Decision: in `modules/src/knowledge/ingestion/`: `pseudo-pages.ts` (`paginate`: pages of at most 3,000 characters, a forced break whenever the heading trail changes, an oversized paragraph is split at whitespace; the heading line is the first text of its page), `docx.ts` (`mammoth.convertToHtml` with images dropped; h1–h6 → trail `A › B`, paragraphs, list items as `• …`, table rows as `cell | cell`), `text.ts` (UTF-8 with BOM removed or Windows-1251 through `iconv-lite`; `\r\n` → `\n`; `#` headings only for `.md`, ignored inside code fences), `transcript.ts` (SRT/VTT cues, markup and VTT header/NOTE/cue settings dropped, cues joined with newlines; a page's locator runs from its first cue start to its last cue end). All return `ExtractedPage[]`; `ExtractedPage` and `savePages` gained `sectionPath` and `locator`. New rejection code `CORRUPT_DOCX`; a DOCX or subtitle file with no text/cues is `EMPTY_FILE`. Pseudo-pages always have `has_text_layer = true`. Test-only zip and cp1251 builders moved to `test-fixtures.ts`.
  - Not handled: DOCX footnotes, headers/footers, text boxes (mammoth ignores them); SRT timestamps with other separators.
  - Page size is characters, as in the plan; the batching step (M1-13) converts to tokens.
- Evidence / links: `modules/src/knowledge/ingestion/parsers.test.ts` (Cyrillic and Spanish in every format, cp1251, Markdown fences, VTT variants, long sections).
- Impact on plan: new dependencies `mammoth`, `iconv-lite` in `@rc/modules`. M1-15 picks the parser by `SniffResult.kind` and file extension (`md` → markdown, `srt`/`vtt` → transcript).

## 2026-10-03 · PDF page extraction [M1-06]
- Context: M1-06 stores per-page text and the text-layer flag; 07 §7.2.2 gives the heuristic.
- Decision: `modules/src/knowledge/ingestion/pdf.ts`. `extractPdfPages(path)` uses `unpdf` (`extractText`, one string per page), strips NUL bytes (Postgres rejects them) and trims; `hasTextLayer` = at least 200 characters and under 5 % U+FFFD. Pages without a text layer are kept with empty or short text, since they still go to Claude as PDF pages. `savePages(ctx, sourceAssetId, attempt, pages)` deletes all existing rows of the source and inserts the attempt's pages (200 per statement) and `page_count` in one transaction, so a failed write keeps the previous pages and a retried job is idempotent. An unreadable PDF raises `SourceRejectedError` `CORRUPT_PDF`. `section_path` stays null for PDFs (no chapter map in MVP).
- Evidence / links: `modules/src/knowledge/ingestion/pdf.test.ts` (3-page fixture built with pdf-lib, image-only page 2 → `has_text_layer = false`; attempt replacement; rollback; 450-page chunking).
- Impact on plan: new dependency `unpdf` in `@rc/modules`. M1-15 calls `sniffSource` → `extractPdfPages` → `savePages` and removes the temp file.

## 2026-10-03 · File sniffing and validation [M1-05]
- Context: M1-05 asks for sniffing, hashing and PDF checks on the real bytes; parsing into pages is M1-06/07.
- Decision: `modules/src/knowledge/ingestion/sniff.ts`. `sniffSource(ctx, {fileKey, fileName, type})` streams the object to a temp file while hashing (SHA-256) and enforcing the per-type size limit, then checks the real type with `file-type` against the file extension: PDF (`pdf-lib` load → encrypted / corrupt / page count ≤ 1,000), DOCX (needs a Word package, a plain ZIP is rejected), text (`file-type` must find nothing; valid UTF-8, else Windows-1251 when ≥ 70 % of high bytes decode to Cyrillic; NUL or > 1 % control bytes → `NOT_TEXT`). It returns kind, size, checksum, temp path + `cleanup()`, page count or encoding; the temp file is removed on every failure. `assertNotDuplicate` (same brand, same checksum, not archived, other id) is separate so M1-15 can order the steps as in 06 J1. Rejections are `SourceRejectedError` (code `VALIDATION`, safe message, `reason` for `processing_error.code`): FILE_MISSING, UNSUPPORTED_TYPE, TOO_LARGE, TYPE_MISMATCH, ENCRYPTED_PDF, CORRUPT_PDF, TOO_MANY_PAGES, EMPTY_FILE, NOT_TEXT, DUPLICATE_SOURCE (with `duplicateOfId`). It is not retryable, so the job runner will not retry it.
  - Windows-1251 is detected with `TextDecoder`; `iconv-lite` is not needed until M1-07 decodes the text.
  - `pdf-lib` reports encryption only through its message, so that is what is matched.
  - A PDF is loaded fully into memory for the check (up to 200 MB on the `medium-1x` machine); revisit if M1-06 shows memory pressure.
- Evidence / links: `modules/src/knowledge/ingestion/sniff.test.ts` with fixtures built in code (valid, renamed, encrypted, corrupt and 1,001-page PDFs; DOCX and plain ZIP; UTF-8 and cp1251 text; PNG and binary renamed to .txt).
- Impact on plan: new dependencies `file-type`, `pdf-lib` in `@rc/modules`.

## 2026-10-03 · Source upload backend [M1-03]
- Context: M1-03 needs storage in services, a status column named `processing_status`, and `archiveSource` needs idea tables that do not exist before M2-01.
- Decision:
  - `ServiceContext.storage` (`StorageProvider`, default refuses every call) is wired in web, jobs and CLI through `createStorage(env.storage)` (`lib/src/providers/storage/factory.ts`).
  - `transition()` takes an optional `statusKey` (default `status`), so `source_assets.processing_status` still changes only through the helper.
  - Services in `modules/src/knowledge/sources/`; actions in `apps/web/src/server/actions/sources.ts` (rights and archive: owner; the rest: any user). Services also refuse non-owner USER actors for those two.
  - Accepted: PDF/DOCX/TXT/MD for BOOK, GUIDE, RECIPE, PRODUCT_MATERIAL; TXT/MD for NOTE; SRT/VTT/TXT for TRANSCRIPT; limits from 07 §7.2.1. VIDEO, INSTAGRAM_POST and PHOTO are rejected with a message (posts come through the historical import, photos are P1).
  - Size mismatch at `completeSourceUpload` → source FAILED (`SIZE_MISMATCH`), object deleted, audit `source.failed`. Missing object → validation error, source stays PENDING_UPLOAD. Calling complete again on QUEUED/BLOCKED returns that status.
  - The checksum column stays empty here; `ingest-source` (M1-15) computes it and detects duplicates (06 J1 step 3). Pasted text keeps its SHA-256 in `metadata_json.sha256`.
  - `ingest-source` is registered as a stub (logs, returns `{stub: true}`; the source stays QUEUED) with a Trigger.dev task on `medium-1x`, 60 min, until M1-15. `source.unblocked` is an extra audit action (BLOCKED → QUEUED after `updateSourceRights`).
  - `archiveSource` is not guarded against live ideas yet: follow-up task M2-01a. It does refuse QUEUED and PROCESSING sources.
  - Job trigger runs after the status transition commits; if the trigger call fails the source stays QUEUED without a run (recovered by reprocess, M1-15).
- Evidence / links: `modules/src/knowledge/sources/sources.test.ts` (limits, size mismatch, BLOCKED path, unblock, audit rows).
- Impact on plan: new task M2-01a in 15.

## 2026-10-03 · Rights gates [M1-02]
- Context: 07 §7.13 and 12 §12.4 define the gates by the permission flags only; `rights_status` is not mentioned.
- Decision: `modules/src/knowledge/rights/`: `canProcessWithAI` / `assertCanProcessWithAI` (throws `RightsBlockedError`), `canVisuallyTransform`, `canUseAsExemplar`, and `getRightsDefault` / `getAllRightsDefaults` reading `rights.defaults` (all-UNKNOWN fallback, confirmation fields stripped). Anything but ALLOWED blocks, so UNKNOWN behaves like DENIED; `improvePrompts` blocks only on DENIED, as in 12 §12.4. A source with `rights_status = RESTRICTED` is blocked by every gate even if its flags say ALLOWED (contradictory data, safer to block).
- Evidence / links: `modules/src/knowledge/rights/*.test.ts` (full matrix: 3 permissions × 4 statuses × 3 gates).
- Impact on plan: M1-03 / `completeSourceUpload` uses `canProcessWithAI` to choose QUEUED vs BLOCKED.

## 2026-10-03 · Knowledge schema 0002 [M1-01]
- Context: 04 §4.3 lists `content_format` under 0003_content, but `historical_posts.format` (0002) uses it.
- Decision: `content_format` is created in 0002 (`db/src/schema/knowledge.ts`). M2-01 must reuse it and not create it again. Extras beyond the plan: `updated_at` triggers on `source_assets`, `knowledge_extraction_batches`, `knowledge_items`, `historical_posts`; `created_at`/`updated_at` on `knowledge_extraction_batches` (plan `ts`). Zod shapes for 0002 are in `db/src/json/knowledge.ts` (`RightsPolicy` stays in `rights.ts`).
- Evidence / links: `db/src/schema/knowledge.test.ts` (migration on PGlite, vector insert + cosine query, partial unique checksum index, cascades, flags GIN query), `db/src/json/knowledge.test.ts`.
- Impact on plan: 04 §4.2 enum placement differs for `content_format`.

## 2026-10-02 · Core AI quality spike, first results [S-01]
- Context: spike on one real source (guide «Не Вари. Проектируй. Крупы», 18 pages, text layer) plus @reg.chef style (one caption and slide descriptions read from the live profile; the local Instagram backup failed on rate limits). Model `claude-opus-5-5`. Scripts `spikes/core-loop/run.mjs` (cards, 1 idea, ES, EN) and `run2.mjs` (3 ideas, 8 checker agents, one repair round). Outputs in git-ignored `spikes/core-loop/out/`. Outputs reviewed by the owner on 2026-10-03; no blocking concerns, S-01 closed.
- Decision / findings:
  - Extraction: 20 cards, 20/20 quotes verbatim in the source; numbers and units preserved in every draft. Single run: ~20k tokens in, ~18.5k out, ~3 min.
  - Invented content: first drafts added scenes and claims absent from the cards ("Monday/Thursday", "change the brand"). A hard ban in the prompt (no facts, scenes or numbers not in the cards) removed scenes but not intensifiers ("most common error", "water never exceeds 100 °C", "it's physics"). A fidelity checker agent finds these reliably.
  - CTA trigger words: the model invents them. Ban plus owner-defined whitelist (СЕКРЕТЫ, ДОСТУП) held 3/3; keep triggers as config, not model output.
  - ES vs EN: drafts were structural translations. Checker failed 3/3 on round 1; telling the writer to use a different hook and caption structure plus one repair round fixed 2/3. Sentence-level translation is still visible.
  - Hook/idea consistency: checker ok 6/6 on round 1, 5/6 after repair.
  - Voice (judge, pass at ≥7/10): 3/6 on round 1, 4/6 after repair.
  - Fidelity: 0/6 on round 1, 1/6 after one repair round. The judge also penalises the author's own "physics" rhetoric, so the rubric must allow brand rhetoric and hold facts and numbers strictly.
  - Cost with checkers: 3 ideas, 63 calls, ~242k tokens in and ~109k out (about 5× the single run per idea). Run the full checker set only on candidates that pass a cheap filter.
  - Data is thin (one source, one caption sample); voice conclusions are preliminary.
- Evidence / links: `spikes/core-loop/out/` (`1-cards-verified.json`, `3-es*.txt`, `3-en*.txt`, `checkers-report.json`, `usage.json`, `usage2.json`).
- Impact on plan: M2-09/10 prompts carry the fact ban and the trigger whitelist; the critic loop (07 §7.6.3) needs 2–3 repair rounds, a separate market brief per language and a fidelity rubric that permits brand rhetoric; M1-12 can reuse the card shape (category, claim, explanation, numbers, quote, page). 20–30 Reg.Chef posts are needed as voice exemplars (B-08) before voice can be judged. 

## 2026-10-02 · Dev-only hello job button [M0-14a]
- Context: M0-14a needs a dev-only button that triggers `hello` through `ctx.jobs` and shows the run id.
- Decision: page `/dev/jobs` (`(app)` group, so it needs a session) with `HelloJobButton` and the server action `runHelloJob` (`server/actions/dev.ts`, owner only) which calls `triggerJob(ctx, "hello", …)` and returns `{ runId, mode }`. Both the page (`notFound()`) and the action (`NotFoundError`) are refused unless `APP_ENV=development` (`server/dev-tools.ts`, unit-tested). Not linked from the sidebar; open `/dev/jobs` by URL.
- Evidence / links: manual check in `pnpm dev` with `JOBS_MODE=inline`: the owner clicked the button; `audit_events` row 6 `job.hello` (actor JOB, run `inline_…`, `request_id` from the request, `name=web`). The Trigger.dev path is the same `ctx.jobs` call and was verified for M0-14 with `pnpm jobs:hello` (row 1); it was not re-run from the button. A stale `next start` production build occupied :3000 and returned 404 for the new page; stop it before `pnpm dev`.
- Impact on plan: M0-14a ticked.

## 2026-10-02 · Dev CLI [M0-21]
- Context: M0-21 needs `pnpm rc <command>` with a ServiceContext for the dev DB and commands registered by modules.
- Decision: new workspace package `cli/` (`@rc/cli`, `tsx --env-file-if-exists=../.env src/main.ts`) is only the composition root: loads env, opens the DB (`DATABASE_URL_DIRECT` if set), builds a context with actor SYSTEM, dispatches. The command type, `runCliCommand` and `cliHelp` live in `@rc/modules/core`; the registry is `@rc/modules/cli-commands` (first command `hello [name]`, runs the hello job handler in-process). The CLI refuses `APP_ENV=production`. `cli/src/main.ts` joins the boundary rules like `apps/web` and `jobs` (public entries only; runtime `@rc/db` allowed in the composition root).
- Evidence / links: `pnpm rc hello m0-21` against the dev database wrote `audit_events` row 5 (`job.hello`, actor SYSTEM). Unit test covers the audit row and unknown/missing command errors.
- Impact on plan: M0-21 ticked; `CLAUDE.md` command table updated; `cli` added to `pnpm-workspace.yaml` and the Vitest projects. `cli/` is not in the 03 §3.1 tree yet.

## 2026-10-02 · Module boundary rules with dependency-cruiser [M0-20]
- Context: M0-20 enforces the dependency rules of 02 §2.4 in CI. dependency-cruiser 18.5 supports TypeScript only below 7, and the workspace uses TypeScript 7.0.2.
- Decision: rules live in `.dependency-cruiser.cjs`, run by `pnpm deps:check` (also part of `pnpm check` and the `static` CI job). TypeScript is parsed with `@swc/core` (`options.parser: "swc"`) instead of installing a second TypeScript; its postinstall is disabled in `allowBuilds` (binary comes from an optional dependency). Rules: no runtime cycles (cycles closed only by `import type` are allowed, e.g. `core/context` ↔ `core/job-runner`); `core` imports no other module; `content`, `publishing`, `analytics` only the domains listed in 02 §2.4; other domains only `core` and themselves; `modules` never imports `apps/*`, `jobs` or `cli`; `apps/web`, `jobs` and `cli` reach modules only through package `index` entries, `job-handlers` and `cli-commands`, use `@rc/db` only for types (composition roots `runtime.ts` and `cli/src/main.ts` excepted), and `apps/web` and `jobs` never import each other; `lib`, `db`, `templates`, `prompts` stay leaves/pure; the web app never imports `modules/visuals/render`. Test files are exempt from the `core` rule (the job-runner test wires the real registry).
- Evidence / links: clean on current code. 12 deliberate forbidden imports, one per rule family, each failed `pnpm deps:check` and were removed. The `visuals/render` rule is not exercised yet because the directory does not exist (an unresolved import is not reported). The tool prints a "missing-typescript-transpiler" notice because it does not recognise TS 7; harmless with swc, exit code 0.
- Impact on plan: M0-20 ticked; CI `static` job gains a "Dependency rules" step; `CLAUDE.md` command table updated.

## 2026-10-02 · Sentry manual check [M0-19]
- Context: M0-19 "Done when" needs a test error in the dev Sentry project with a request id and no secrets. The old US organisation `skak` has an exhausted error quota, so a new organisation was created.
- Decision: organisation `chefskak` in the **EU region** (ingest `de.sentry.io`), projects `regchef-web` (Next.js) and `regchef-jobs` (Node). `.env` carries the web DSN (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT=development`). `.env` holds one `SENTRY_DSN`, and the Trigger.dev dev worker re-reads it, so the jobs check needs the jobs DSN swapped into `.env` for the run; in Trigger.dev and Vercel the two DSNs are set separately.
- Evidence / links: web (production build + `next start`): `/api/dev/sentry-test` → 500, issue REGCHEF-WEB-1, tag `request_id` equals the response `x-request-id`, title shows `access_token=[REDACTED]`, no cookies, no `Authorization` header, `environment=development`, release = git SHA. Jobs (`pnpm jobs:dev` + `JOBS_MODE=trigger pnpm jobs:hello --fail`): REGCHEF-JOBS-1 with `task_id=hello`, matching `run_id`, `[REDACTED]` token. `hello --fail` ends in a PermanentError (no retries), so the final-failure hook fires at once. A first run with the web DSN produced REGCHEF-WEB-2 (jobs error in the web project); resolve or delete it.
- Impact on plan: M0-19 ticked. Gaps: the sentry-test route sets no user, and no code calls `Sentry.setUser`, so events carry no user id (the runbook line "user = id only" is not exercised); the jobs event has no `request_id` tag because `jobs:hello` sends no `meta.requestId`.

## 2026-10-02 · Magic link manual check; default mailer and PKCE callback [M0-15]
- Context: the dev Supabase project has no custom SMTP. The default mailer cannot edit the Magic Link template (still `{{ .ConfirmationURL }}`) and only delivers to members of the Supabase organisation. The documented template (`/auth/confirm?token_hash=…`) is therefore not usable in dev.
- Decision: `/auth/confirm` accepts both `?code=` (PKCE, `exchangeCodeForSession`) and `?token_hash=&type=` (`verifyOtp`). `requestMagicLink` passes `emailRedirectTo = <origin>/auth/confirm` (origin from the request headers); `http://localhost:3000/auth/confirm` is in the project's Redirect URLs. The owner's email was invited to the Supabase organisation so the default mailer delivers to it. Production still needs custom SMTP and the `token_hash` template (supabase.md step 6); preview/prod origins must be added to Redirect URLs.
- Evidence / links: with sign-ups off, an allowlisted address got a link (`delivered:true`), opening it in the same browser gave `GET /auth/confirm?code=… 307` → `/dashboard 200`; `not-allowed-test@example.com` got the same neutral message and no email (`delivered:false`).
- Impact on plan: `docs/runbooks/supabase.md` step 3 applies to custom SMTP only; M0-15 ticked. `apps/web` needs `.env` in its own folder for `next dev` (symlink `apps/web/.env` → `../../.env`, git-ignored).

## 2026-09-28 · Sentry, request ids and console scrubbing [M0-19]
- Context: M0-19 (12 §12.7, §12.9): Sentry for web (server + client) and jobs, release = git SHA, scrubbed events, `x-request-id` → ServiceContext → job `meta.requestId`.
- Decision:
  - SDKs `@sentry/nextjs` / `@sentry/node` **11.0.0**. Sentry 11 changes found while wiring: `withSentryConfig` moved to `@sentry/nextjs/config`; `sendDefaultPii` was replaced by `dataCollection`.
  - Web: `src/instrumentation.ts` (`register` → `sentry.server.config.ts`; `onRequestError = captureRequestError`), `src/instrumentation-client.ts` (DSN from `NEXT_PUBLIC_SENTRY_DSN`), `withSentryConfig` in `next.config.ts` (source maps only with `SENTRY_AUTH_TOKEN`; release = `APP_RELEASE` or `VERCEL_GIT_COMMIT_SHA`). Node runtime only, no edge config. CSP `connect-src` allows `*.ingest{,.us,.de}.sentry.io`. `runAction` reports unexpected errors (tags `action`, `request_id`) through a new optional `report` dependency.
  - Jobs: `jobs/src/tasks/init.ts` (Trigger.dev v4 init file) initialises `@sentry/node` with `defaultIntegrations: false` and reports the final failure of a run via `tasks.onFailure` (tags `task_id`, `run_id`, `request_id`; payload not sent). Source maps via `esbuildPlugin(sentryEsbuildPlugin)` on deploy only when `SENTRY_AUTH_TOKEN` is set.
  - Shared in `@rc/lib/observability`: `scrubSentryEvent` (beforeSend: URL/query/headers/cookies/body/exception/breadcrumbs/extra/contexts; user id only; `x-request-id` header → `request_id` tag) and `sentryDataCollection()` (no user info, cookies, bodies, DB query data, stack variables, **no gen-AI inputs/outputs** because prompts contain source IP; header allowlist incl. `x-request-id`). Browser-safe imports (no pino in the client bundle).
  - Env: `observability.release` from `APP_RELEASE ?? VERCEL_GIT_COMMIT_SHA`; web and jobs loggers now log `release`.
  - `proxy.ts` keeps a well-formed incoming `x-request-id` (`[A-Za-z0-9._:-]{8,64}`) or creates a UUID, forwards it to the app and sets it on every response (incl. redirects and 401).
  - **Found in the live check:** Next.js prints unhandled route-handler errors with `console.error`, bypassing the redacting logger — a fake token appeared in stdout in clear text. `installConsoleScrubber()` (web `instrumentation.ts`, jobs `init.ts`) now scrubs `console.error` / `console.warn` arguments (strings, Error message/stack, objects). Re-checked: raw token 0, `access_token=[REDACTED]` 1.
  - Manual check helpers: `GET /api/dev/sentry-test` (development only, needs a session) and `pnpm jobs:hello --fail` (hello payload `fail`).
  - pnpm `allowBuilds: "@sentry/cli": false` (binary comes from an optional platform package).
  - Runbook `docs/runbooks/sentry.md`.
- Evidence / links: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/, https://trigger.dev/docs/guides/examples/sentry-error-tracking. Tests: `lib/src/observability/*.test.ts`, `apps/web/src/server/request-id.test.ts`, `run-action.test.ts` (report only unexpected errors), `jobs/src/sentry.test.ts`, hello `fail`. Live: own id echoed, bad id replaced, redirects carry the id, `/api/dev/sentry-test` → 500 with the given id.
- Impact on plan: pending manual check with the dev Sentry projects (runbook "Manual check"); M0-19 is ticked after it.

## 2026-09-28 · Brand and market settings [M0-18]
- Context: M0-18 (05 §5.2): brand and market editors; actions `updateBrand`, `updateMarket`, `upsertTaxonomyTerm`, `setAppSetting` with audit.
- Decision:
  - New module subpath `@rc/modules/settings` (brand, taxonomy, app settings): 02 §2.2 has no owner for these tables, and `core` stays infrastructure. The market profile service lives in `@rc/modules/localization` (02 §2.2).
  - `updateBrand` (owner): `visualSystem` validated with `VisualSystem`; errors come back as `visualSystem.<path>`; audit `brand.updated` with the changed field names.
  - `updateMarket` (owner, editor): Zod for all fields; `ForbiddenPatternList` compiles REGEX patterns (`iu`) so an invalid regex rejects the whole save with `forbiddenPatterns.<i>.pattern`; time zones checked with `Intl.DateTimeFormat`; only owners may change `isActive` (`ForbiddenError`); audit `market.updated` with changed field names only; no write and no audit when nothing changed.
  - `upsertTaxonomyTerm` (owner): code `UPPER_SNAKE_CASE`; upsert on `(kind, code)`; no delete (deactivate instead); audit `settings.changed` with `termCode` — a `code` key would be redacted by the audit/log scrubber (M0-05).
  - `setAppSetting` (owner): allowed keys `publishing.enabled`, `publishing.min_gap_minutes` (0–1440), `analytics.min_sample` (1–1000), `rights.defaults` (`RightsDefaults`); `updated_by` = actor; audit `settings.changed` with from/to (rights defaults: key only). No UI yet: the kill switch UI is H-01 (`/settings/health`), rights defaults with M1.
  - UI: `/settings/brand` (brand form with Markdown voice guide, visual system JSON editor with parse errors and server field errors, taxonomy tabs with inline label edit, (de)activate, add term); `/markets/[code]` (general, tone and food culture, vocabulary / forbidden patterns (client regex check) / visual hypotheses row editors, sticky save bar). Read-only for roles that cannot edit.
  - Toasts moved to the top centre: at the default bottom-right an error toast covered the sticky save button, and a second save click never reached the form (found in the live check).
- Evidence / links: `modules/src/settings/settings.test.ts`, `modules/src/localization/update-market.test.ts` (edits persist with audit rows; invalid regex rejected with a field path and nothing saved). Live check against dev Supabase (one-off E2E test-login): invalid regex refused by client and server; valid save stored tone notes + pattern with a `market.updated` audit row (actor USER, request id, `fields`), then reverted through the UI; invalid visual system refused with `colors.accent` / `logo.minHeightPx` messages and nothing written.
- Impact on plan: none.

## 2026-09-28 · App shell and navigation [M0-17]
- Context: M0-17 (10 §10.1 navigation, 10 §10.2 screen catalog).
- Decision:
  - One screen catalog (`apps/web/src/components/shell/screens.ts`: route, title, purpose, building task, P1 flag) drives the sidebar and every placeholder page; a test checks that each catalog route has a `page.tsx`.
  - Sidebar per 10 §10.1. **Markets come from the database** (`@rc/modules/localization` `listMarkets`, sidebar order); inactive markets (fr-FR) are shown disabled with "later". P1 screens carry a "P1" note.
  - `/` redirects to `/dashboard` (10 §10.2). Placeholder pages for all 21 catalog routes, including dynamic ones (`/content/ideas/[id]`, `/content/review/[ideaId]`, `/content/published/[publicationId]`, `/knowledge/sources/[id]`, `/knowledge/cards/[id]`, `/markets/[marketCode]`); unknown market codes → 404.
  - User menu (Base UI dropdown): email, role, sign out (POST `/auth/sign-out`). Mobile: the sidebar moves into a left sheet that closes on navigation.
  - Banner slot `Banners` with typed banners (`info | warning | danger`); sources (kill switch, re-auth, token expiry) are added by M4/M5/H-01, so it renders nothing now.
  - `@rc/db/seed` subpath export (tests of other packages seed with it).
- Evidence / links: `screens.test.ts`, `modules/src/localization/markets.test.ts`. Live run against dev Supabase with a one-off E2E test-login (secret passed on the command line only): all 25 routes → 200 with a session (`/markets/de-DE` → 404), 307 to `/login` without; sidebar, active item, disabled France, user menu, mobile sheet and sign-out checked in the browser at 1280×800 and 375×812; no console errors.
- Impact on plan: none.

## 2026-09-27 · Dev Supabase project stays in London (eu-west-2) [B-02]
- Context: D-03 and `docs/runbooks/supabase.md` specify EU Central (Frankfurt). The dev project (`udvisikrshcnbjddgrsr`) was created in `eu-west-2` (London); Supabase cannot move a project between regions.
- Decision: keep the dev project in London. It holds no real user data; the UK has a GDPR adequacy decision. The **prod** project is still created in Frankfurt.
- Evidence / links: pooler host `aws-0-eu-west-2.pooler.supabase.com`; both connection strings and Supabase Auth checked from the owner's machine on 2026-09-27; migrations `0000`–`0001` already applied.
- Impact on plan: `docs/runbooks/supabase.md` (Projects) notes the dev region. D-03 unchanged for production.

## 2026-09-27 · Authentication design; V-20 auth part [M0-15]
- Context: M0-15 (01 D-07, 12 §12.5). V-20 still had the Auth part open.
- V-20 (Supabase docs, 2026-09-27): server code must verify sessions with `getClaims()` (verifies the JWT) or `getUser()`, never trust `getSession()`; the proxy refreshes cookies with `getClaims()`. SSR magic links use the email template `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` and `verifyOtp` on the server. Default mailer: one link per address per 60 s, links expire after 1 h → custom SMTP for production. Supabase now names the public key "publishable key"; the anon key still works.
- Decision:
  - Supabase is used **server-side only** (`@supabase/ssr` 0.12.7 server client, `proxy.ts`, route handlers, server actions). No browser client, so no `NEXT_PUBLIC_*` variables; `SUPABASE_ANON_KEY` holds the anon or publishable key.
  - Allowlist logic in `@rc/modules/core/users.ts`: `resolveAppUser` (by `auth_user_id`, else link by case-insensitive email on first login with audit `user.linked`; refuse `unknown`, `inactive`, `email_linked_to_other_account`), `isEmailAllowed`, `requireRole` (`ForbiddenError`).
  - Web: `src/proxy.ts` (session refresh; no session → `/login?next=…` for pages, 401 for `/api/*`; public: `/login`, `/auth/*`, `/api/health`, `/api/meta/*`), `requireUser()` / `requireAppRole()` (allowlist re-checked per request; refused sessions are signed out with a message), `/login` (server action; always answers "sent"; `signInWithOtp({ shouldCreateUser: false })` only for allowlisted active emails), `/auth/confirm` (`verifyOtp`, safe `next`), `/auth/sign-out`, `/auth/test-login` (404 unless non-production and the exact `E2E_TEST_AUTH_SECRET`; uses the service role to generate a link). `src/server/context.ts` builds a `ServiceContext` per request (request id from `x-request-id` or random; jobs via Trigger.dev or inline background runner).
  - Users are created by the owner in Supabase (sign-ups off); runbook updated.
  - `(app)` routes are `force-dynamic`; the placeholder dashboard moved to `(app)/page.tsx`.
  - Tests got slow as PGlite tests grew (initdb ~1.4 s per database; ~60 s total, hook timeouts in parallel). `createTestDb()` now starts every database from a migrated template dump cached in the OS temp dir by migration hash (~0.3 s each; full run ~30 s cold, ~12 s warm). Root Vitest config sets `hookTimeout 60 s`, `testTimeout 30 s` for all projects (`extends: true`).
- Evidence / links: https://supabase.com/docs/guides/auth/server-side/nextjs, https://supabase.com/docs/guides/auth/auth-email-passwordless. Tests: `modules/src/core/users.test.ts`, `apps/web/src/server/auth/rules.test.ts`. Smoke run of `next start` with synthetic env: `/` → 307 `/login`, deep link keeps `next`, `/api/preview/slide` → 401, `/auth/confirm` without token → `/login?error=link_invalid`, test-login with a wrong secret → 404.
- Impact on plan: pending manual check with the dev Supabase project (allowlisted email logs in; unknown email refused); M0-15 is ticked after it.

## 2026-09-27 · V-17 verified; job runner and Trigger.dev setup [M0-14]
- Context: M0-14 needs V-17 (Trigger.dev version, idempotency scopes and TTL, failed-run behaviour, machines).
- V-17 results (Trigger.dev docs, 2026-09-27): SDK/CLI **4.6.4**; `runtime: "node-24"` available. `idempotencyKeys.create(key, { scope })` with `run` (default, also for raw strings since v4.3.1), `attempt`, `global`; TTL default 30 days (`idempotencyKeyTTL`). A **failed** run's key is cleared (re-trigger → new run); succeeded/canceled runs keep it. Outside a task all scopes act global. Machines: `small-1x` 0.5 vCPU/0.5 GB (default), `medium-1x` 1 vCPU/2 GB. `AbortTaskRunError` stops retries. Queues are defined in code with `queue({ name, concurrencyLimit })`; `concurrencyKey` at trigger time. Backend triggering: `tasks.trigger(id, payload, { idempotencyKey, delay, tags, concurrencyKey })` with `TRIGGER_SECRET_KEY`. Remaining V-17 items (Playwright extension, `wait.for`, `batchTriggerAndWait`, regions) belong to M3-12 and later.
- Decision:
  - `@rc/modules/core/job-runner`: `defineJob`, `JobRunner`, `runJobHandler` (Zod payload validation → `ValidationError`), `triggerJob(ctx, …)` (adds `requestId`), `createInlineJobRunner` (await/background, Trigger.dev-like idempotency, `getRun`), `createTriggerDevJobRunner` (global-scope keys prefixed with the job name, `delay` in seconds), `disabledJobRunner` (default in contexts). `ServiceContext` gained `jobs`.
  - Registry `modules/src/job-handlers.ts`; core learns names and payload types through declaration merging (`interface JobRegistry`), which avoids a core → handlers → modules cycle.
  - Wire format `{ payload, meta: { requestId } }`.
  - `jobs/`: `trigger.config.ts` (project ref from `TRIGGER_PROJECT_REF`, dirs `src/tasks`, node-24, small-1x, maxDuration 900 s, retry defaults from 06 §6.1, empty build extensions), `queues.ts`, `handlerTask()` (task id = job name; non-retryable errors → `AbortTaskRunError` with a scrubbed message), `hello` task, `pnpm jobs:dev`, `pnpm jobs:hello`.
  - **Deviation:** the dev-only button from the M0-14 "Done when" needs auth (M0-15) and actions (M0-16); `pnpm jobs:hello` triggers the same path from the CLI instead. The button is follow-up task **M0-14a**.
  - pnpm `allowBuilds: "@depot/cli": false` (remote builds for `trigger deploy`; revisit with CI deploys).
  - Runbook `docs/runbooks/trigger-dev.md` (project, local dev, how jobs are wired, alert channel setup).
- Evidence / links: https://trigger.dev/docs/idempotency, https://trigger.dev/docs/config/config-file, https://trigger.dev/docs/queue-concurrency, https://trigger.dev/docs/machines, https://trigger.dev/docs/errors-retrying, https://trigger.dev/docs/triggering. Tests: `modules/src/core/job-runner.test.ts` (inline hello → audit row), `jobs/src/jobs.test.ts`.
- Impact on plan: new task M0-14a. Pending manual check: `pnpm jobs:dev` + `pnpm jobs:hello` against the dev Trigger.dev project; M0-14 is ticked after it.

## 2026-09-27 · V-22 verified; storage provider [M0-13]
- Context: M0-13 needs V-22 (R2 presigned PUT and CORS, single PUT limit, EU jurisdiction, public bucket option).
- V-22 results (Cloudflare docs, 2026-09-27):
  - Presigned URLs support GET, PUT, HEAD, DELETE; expiry 1 s – 7 days; SDK region `auto`. They work only on the S3 API domain, **not on custom domains**.
  - PUT can bind `ContentType` (mismatch → 403). Binding `Content-Length` is not documented; we sign it anyway and the gated live test checks it. `completeSourceUpload` also compares sizes with HEAD.
  - Browser uploads need a bucket CORS policy.
  - Single PUT ≈ 5 GiB; objects up to ≈ 5 TiB.
  - EU jurisdiction is chosen at bucket creation, cannot be changed, and needs the endpoint `https://<account>.eu.r2.cloudflarestorage.com`.
- Decision:
  - `StorageProvider` in `@rc/lib/providers/storage`: `presignPut`, `presignGet`, `head` (null if missing), `getStream` (web ReadableStream), `getBytes`, `put`, `delete` (missing is fine). R2 adapter on `@aws-sdk/client-s3` 3.1141 with `requestChecksumCalculation/responseChecksumValidation: WHEN_REQUIRED` (otherwise presigned PUTs could demand checksum headers). Errors: 404 → `NotFoundError`, 429 / 5xx / network → `TransientError`, others → `PermanentError`; details carry operation, key and status only.
  - New optional env `R2_JURISDICTION` (`eu`).
  - In-memory fake with `memory://` presigned URLs; one contract suite runs on the fake always and on R2 in `r2.live.test.ts` when `R2_LIVE_TEST=1` (Biome allows `process.env` in `*.live.test.ts` only).
  - `storageKeys` for the 08 §8.8 layout; ids must be single path segments. `safeFileName()` keeps the extension and ASCII only, so Russian names become `file.<ext>` (the original name stays in the DB).
  - `PRESIGN_TTL` holds the 12 §12.4 lifetimes.
  - Runbook `docs/runbooks/r2-setup.md`.
- Evidence / links: https://developers.cloudflare.com/r2/api/s3/presigned-urls/, https://developers.cloudflare.com/r2/platform/limits/, https://developers.cloudflare.com/r2/reference/data-location/, https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/.
- Impact on plan: the live R2 check runs once a dev bucket exists (B-02); record the result here.

## 2026-09-27 · Core module design [M0-12]
- Context: 02 §2.2 lists the `ServiceContext` members; 04 §4.7 rule 6 defines the conditional status update.
- Decision:
  - `ServiceContext` = `{ db, logger, clock, actor, requestId }`. `db` is `AnyDatabase` (postgres.js, PGlite or a transaction). Storage (M0-13), job runner (M0-14) and AI providers (M1-08) are added by those tasks, not as placeholders now. `createServiceContext()` binds `requestId`, actor type and user/run id to the logger.
  - `Actor` = `USER {userId, role}` | `SYSTEM` | `JOB {jobRunId}`; `audit()` maps it to `actor_type`, `actor_user_id`, `job_run_id`, takes `occurred_at` from the injected clock and redacts `data`.
  - `transition()` runs in one transaction: `SELECT … FOR UPDATE` (to know the previous status for the error and the audit row), then `UPDATE … WHERE id = $id AND status = ANY($from) RETURNING *`, then an audit event (default action `<table>.status_changed`, data `{ from, to, … }`). Audit is always written, so DoD rule 4 cannot be skipped. Unknown id → `NotFoundError`; wrong status → `InvalidStateError` with `{ from, allowedFrom, to }`.
  - `withTransaction(ctx, fn)` passes a context bound to the transaction; nested calls use savepoints.
  - `@rc/db/orm` and `@rc/db/pg-core` re-export drizzle so every package uses the one drizzle-orm instance that @rc/db resolves with its peers (a second copy would break types and `instanceof`).
- Evidence / links: `modules/src/core/core.test.ts` (PGlite: allowed / refused / not found / rollback / chained transitions, audit rows).
- Impact on plan: none.

## 2026-09-27 · Seed behaviour and default rights [M0-11]
- Context: M0-11 asks for an idempotent seed; the plan does not give default rights values and does not say whether a re-run may overwrite rows.
- Decision:
  - `seedDatabase()` inserts only missing rows (`ON CONFLICT DO NOTHING`) in one transaction and never updates existing ones, so edits made in the app (voice guide, labels, roles, kill switch) survive a re-run. Changing seed data later needs a migration or an in-app edit, not a re-seed.
  - `rights.defaults`: every permission `UNKNOWN` for all 9 source types. The rights gate then blocks AI processing until the owner confirms the matrix (Track B B-04). `RightsPolicy` / `RightsDefaults` Zod schemas and `SOURCE_TYPES` added to `@rc/db/json` now (the `source_type` enum arrives with 0002 and should reuse the list).
  - Markets per A-06 (es-ES and en active, fr-FR inactive); `en` gets the tone note "US spelling, °F first with °C in brackets". Taxonomy per 04 §4.7 with labels derived from codes (e.g. "Myth vs fact"), to be refined with Sergey (B-08).
  - Owners come from `SEED_OWNER_EMAILS` (validated, lower-cased) through `loadSeedEnv()` in `@rc/lib/env`.
- Evidence / links: `db/src/seed/seed.test.ts` (two runs → identical rows; edits survive; A-06 values; rights parse).
- Impact on plan: none. Run `pnpm db:seed` on dev Supabase after merge.

## 2026-09-27 · Core schema details [M0-10]
- Context: 04 §4.3 (0001_core) and §4.4 define the tables and JSON shapes.
- Decision:
  - Drizzle schema in `db/src/schema/core.ts`, migration `0001_core.sql` generated by drizzle-kit and extended by hand with `set_updated_at()` and one `BEFORE UPDATE` trigger per table with `updated_at` (app_users, brands, markets, taxonomy_terms, app_settings). Later migrations add the trigger for their own tables.
  - RLS through Drizzle `.enableRLS()`, so the `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statements live in the generated migration and the snapshot.
  - Constraint names are snake_case (the `auth_user_id` unique constraint is named explicitly; drizzle-kit would use the camelCase key).
  - Foreign keys use the Postgres default (`NO ACTION`), which blocks deletes like `RESTRICT`.
  - `brands.visual_system` keeps the plan's default `{}` and is typed `VisualSystem | {}` ("not configured"); the full `VisualSystem` Zod schema applies on write (M0-18). `themeVariants` defaults to `{}`.
  - `ForbiddenPattern` compiles REGEX patterns with flags `iu` at validation time; PHRASE patterns are not compiled.
  - Zod JSON schemas are exported from `@rc/db/json`.
- Evidence / links: `db/src/schema/core.test.ts`, `db/src/json/core.test.ts`.
- Impact on plan: none. Apply `0001` to dev Supabase with `pnpm db:migrate` after merge.

## 2026-09-27 · V-20 (database part) verified; database package [M0-09]
- Context: M0-09 needs V-20 for pgvector and the pooler; Auth/SMTP and PITR parts belong to M0-15 / H-03.
- V-20 results (Supabase docs, 2026-09-27):
  - Connection modes: direct `db.<ref>.supabase.co:5432` (IPv6 unless IPv4 add-on; prepared statements OK); shared pooler session mode `:5432` (IPv4, prepared statements OK); shared pooler transaction mode `:6543` (IPv4, for serverless, **no prepared statements → `prepare: false`**); dedicated pooler `:6543` (paid, transaction only).
  - pgvector is enabled with `create extension vector with schema extensions`.
- Decision:
  - drizzle-orm 0.45.3 + drizzle-kit 0.31.11 (latest stable; 1.0 is still RC), postgres.js 3.4.9, PGlite 0.5.8. In PGlite 0.5 pgvector is a separate package, `@electric-sql/pglite-pgvector`.
  - `createDb(url, { pooled, max })` sets `prepare: !pooled`; `isPoolerUrl()` detects port 6543. Casing `snake_case`.
  - `createTestDb()` (subpath `@rc/db/test-db`, so production code never imports PGlite): in-memory PGlite + pgvector + all migrations.
  - `0000_extensions.sql` uses a `DO` block: `vector` goes into the `extensions` schema when it exists (Supabase), else the default schema (PGlite).
  - `pnpm db:migrate` (tsx, reads `../.env`) uses `DATABASE_URL_DIRECT`, falling back to `DATABASE_URL` with a warning if that is the transaction pooler. `loadDbEnv()` in `@rc/lib/env` validates only the database variables.
  - pnpm `allowBuilds: esbuild: false`: the binary comes from an optional dependency; tsx and drizzle-kit work without the postinstall.
  - Connection strings documented in `docs/runbooks/supabase.md`.
- Evidence / links: https://supabase.com/docs/guides/database/connecting-to-postgres, https://supabase.com/docs/guides/database/extensions/pgvector. `db/src/test-db.test.ts` (PGlite: extension, HNSW index, cosine order). `migrate.ts` was also run over the wire against a PGlite socket server: first run applied 0000, second run was a no-op.
- Manual run (owner, 2026-09-27): `pnpm db:migrate` against dev Supabase through the session pooler → `done`. Read-only check: `vector` 0.8.2 in schema `extensions`, 1 migration recorded, Postgres 17.6.
- Open point: the dev project is in **eu-west-2 (London)**, while 01 D-03 / the runbook say EU Central (Frankfurt) next to Vercel `fra1`. Fine for dev. For prod either create `regchef-prod` in Frankfurt (recommended) or move Vercel to `lhr1`; decide before M5 / G2.
- Impact on plan: none.

## 2026-09-27 · V-21 verified; web app setup [M0-08]
- Context: V-21 (Vercel limits, region, Node; Next.js major) must be checked before M0-08.
- V-21 results (official docs, 2026-09-27):
  - Next.js current stable is 16.3.6. `middleware.ts` is deprecated and renamed to `proxy.ts` (export `proxy`), which runs on the Node.js runtime by default. Server functions are not covered by proxy matchers, so every action still checks auth itself (as 05 §5.1 already says).
  - Vercel Functions (Fluid compute): request/response body 4.5 MB; max duration 300 s default, 300 s max on Hobby, 800 s on Pro; memory 2 GB default. Default region is `iad1`, so `fra1` is set explicitly in `apps/web/vercel.json`. Node.js 24.x is the Vercel default; `engines.node >=24` maps to 24.x.
- Decision:
  - Next.js 16.3.6 + React 19.3, Tailwind 4.3 (`@tailwindcss/postcss`), shadcn 4.21 with its default `base-nova` preset (Base UI primitives, `cn` package from shadcn). Components: button, input, textarea, select, dialog, sheet, dropdown-menu, tabs, table, badge, card, skeleton, tooltip, popover, sonner, plus `field` (with label, separator) instead of `form`: the `form` component is not in the base-nova registry.
  - No `next/font/google`: it downloads fonts at build time and cloud sessions have restricted network. The admin UI uses a system font stack; brand fonts belong to `@rc/templates` (M3).
  - `next.config.ts`: `transpilePackages` for all workspace packages, `serverExternalPackages` `sharp`/`playwright-core`, `poweredByHeader: false`, security headers from `src/server/security-headers.ts`. CSP hosts are wildcards (`*.supabase.co`, `*.r2.cloudflarestorage.com`) so the build needs no env. `script-src` has `'unsafe-inline'` because Next.js injects inline hydration scripts; a nonce-based CSP would force dynamic rendering (revisit in H-02).
  - `/api/health` is static `{ status: "ok" }`; H-01 adds checks.
  - `next-env.d.ts` is generated and git-ignored; `tsc` passes without it.
  - Biome: CSS parser with Tailwind directives; for vendored `apps/web/src/components/ui/**` the rules `a11y/useSemanticElements`, `a11y/noLabelWithoutControl`, `suspicious/noArrayIndexKey` are off (shadcn design choices). One shadcn type error under `exactOptionalPropertyTypes` (sonner) was fixed in place; the strict flag stays on for the web app.
  - CI `build` job enabled. Root scripts `pnpm dev` / `pnpm build`.
- Evidence / links: https://nextjs.org/docs/app/api-reference/file-conventions/proxy, https://vercel.com/docs/functions/limitations, https://vercel.com/docs/functions/runtimes/node-js/node-js-versions, https://vercel.com/docs/regions. Local `next build` + `next start`: `/api/health` ok, headers present, page renders with no console (CSP) errors.
- Impact on plan: 03 §3.1 tree shows `src/proxy.ts` instead of `middleware.ts`; M0-15 creates `proxy.ts`.

## 2026-09-27 · Crypto utilities [M0-07]
- Context: 12 §12.3 defines token encryption, OAuth state and Meta `signed_request` checks.
- Decision:
  - `encrypt`/`decrypt` (`@rc/lib/security`): AES-256-GCM, random 12-byte IV, 16-byte tag, AAD required (non-empty), format `enc:<keyId>:<iv>:<tag>:<ciphertext>` (base64url). `decrypt` uses the key id in the value, so old keys keep working after rotation. `encryptedKeyId()` lets the re-encryption script find old values. All failures throw `PermanentError` with only the key id in details.
  - OAuth state: `signToken(data, { secret, expiresAt })` / `verifyToken(token, { secret, now })` → `<payload>.<hmac>` (HMAC-SHA256, base64url; payload signed, not encrypted). Verification returns `{ ok: false, reason: "malformed" | "bad_signature" | "expired" }` instead of throwing, so the callback can audit the reason. `createNonce()` gives 128-bit nonces.
  - `parseSignedRequest()` checks HMAC-SHA256 over the encoded payload with the app secret and `algorithm = HMAC-SHA256`. It does not check `issued_at` freshness; V-13 (M5-00) re-checks the format against Meta docs.
  - `safeEqual()` hashes both sides with SHA-256 before `timingSafeEqual`, so the time does not depend on length.
  - `KeyRing` is `{ keys, activeKeyId }`; build it from `env.security.tokenEncryptionKeys` / `activeKeyId`.
- Evidence / links: `lib/src/security/security.test.ts`.
- Impact on plan: none.

## 2026-09-27 · Error model details [M0-06]
- Context: M0-06 lists the error classes; 05 §5.1 defines `ErrorCode` for `ActionResult`; 06 §6.1 defines retry rules.
- Decision:
  - `ErrorCode` and `ERROR_CODES` live in `@rc/lib/errors`; M0-16 (`defineAction`) imports them instead of redefining them.
  - Added `UnauthenticatedError` (code `UNAUTHENTICATED`, needed by M0-15/M0-16; not in the M0-06 list).
  - Class → code: Validation `VALIDATION`, NotFound `NOT_FOUND`, Conflict `CONFLICT`, InvalidState `INVALID_STATE`, Forbidden `FORBIDDEN`, RightsBlocked `RIGHTS_BLOCKED`, Transient `EXTERNAL_ERROR` (or `RATE_LIMITED` with `rateLimited: true`, plus optional `retryAfterMs`), Permanent `EXTERNAL_ERROR`.
  - `exposeMessage`: domain errors show their message to users. `TransientError`/`PermanentError` carry vendor text, so `toPublicError()` replaces it with a generic message. Unknown errors → `INTERNAL`. `details` never reach the UI.
  - `isRetryable()`: `TransientError` → true; other AppErrors → false; unknown errors → true (06 §6.1: retry up to `maxAttempts`).
  - `ValidationError.fromZod()` keys field errors by dotted path (`slides.2.headline`); issues without a path go under `_form`.
  - `serializeError()` (M0-05) now also logs `details`, redacted.
- Evidence / links: `lib/src/errors/errors.test.ts`.
- Impact on plan: none.

## 2026-09-27 · Redaction by key rules instead of pino redact paths [M0-05]
- Context: 12 §12.7 lists pino `redact` paths like `*.access_token`. pino wildcards match one level only, and pino does not run `formatters.bindings` for child loggers.
- Decision:
  - One `redact()` for logs and audit data. It walks the object at any depth: values under sensitive keys become `[REDACTED]`, every string passes through `scrubText()`, errors go through `serializeError()`, binary data becomes `[Binary N bytes]`, cycles and depth over 8 are cut. A key is sensitive if it is `code` or contains `token`, `secret`, `password`, `passwd`, `apikey`, `authorization`, `cookie`, `signedrequest`, `privatekey` or `credential` (compared lowercased, without `-`/`_`). Numbers and booleans under such keys are kept, so token counts (`inputTokens`) stay in logs.
  - Because `code` is always redacted, log domain codes under another key (e.g. `errorCode`). `err.code` is kept, because `serializeError()` builds the error output itself.
  - `scrubText()` / `scrubUrl()` remove query values of `access_token`, `refresh_token`, `id_token`, `token`, `client_secret`, `code`, `signed_request`, `api_key`, `password`, `sig`, `signature` and every `X-Amz-*`; passwords in `scheme://user:pass@`; Bearer/Basic credentials.
  - pino setup: `formatters.log` = `redact`, `msg` serializer = `scrubText`, `err` serializer = `serializeError`. `child()` is wrapped on every instance so child bindings are redacted too. Default output is synchronous stdout (serverless-safe). Fields: `ts`, `level` (label), `service`, `env`, `release`, `msg`.
- Evidence / links: `lib/src/logging/*.test.ts`; pino 10.3.1 source (`child()` resets the bindings formatter).
- Impact on plan: none. M0-19 reuses `redact()` / `scrubText()` in Sentry `beforeSend`.

## 2026-09-27 · Environment variables and flags [M0-04]
- Context: 12 §12.2 lists the secrets and 15 M0-04 the flags. The plan does not define how "production" is detected, the flag values besides the ones named, or which variables each mode needs.
- Decision:
  - New `APP_ENV` = `development | test | staging | production` (default `development`). It decides production guards. `NODE_ENV` is not used for this because `next build` sets it to `production` on previews too.
  - Flag values and defaults: `JOBS_MODE` `inline|trigger` (default `inline`), `AI_PROVIDER` `live|fake` (default `live`), `STORAGE_PROVIDER` `r2|memory` (default `r2`), `INSTAGRAM_PUBLISH_MODE` `off|dry_run_only|live` (default `off`).
  - Production guards: besides `JOBS_MODE=trigger` and no `E2E_TEST_AUTH_SECRET` (plan), production also refuses `AI_PROVIDER=fake` and `STORAGE_PROVIDER=memory`.
  - Mode-specific variables are required only in that mode: R2 for `r2`, both AI keys for `live`, `TRIGGER_SECRET_KEY` for `trigger`, the Instagram app variables for `dry_run_only`/`live`. M5-02 (OAuth) may need the Instagram app variables while publishing is `off`; revisit there.
  - Always required: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TOKEN_ENCRYPTION_KEYS` (validated key ring, 32-byte keys), `TOKEN_ENCRYPTION_ACTIVE_KEY` (must exist in the ring), `OAUTH_STATE_SECRET` (≥ 32 chars).
  - New optional `LOG_LEVEL` (pino levels, default `info`) for M0-05.
  - `TRIGGER_ACCESS_TOKEN` and `SENTRY_AUTH_TOKEN` are CI-only and not part of the runtime schema; `SEED_OWNER_EMAILS` is left to M0-11.
  - `loadServerEnv()` reports all problems at once as names with a reason; values are never printed. Biome rule `style/noProcessEnv` enforces "no `process.env` outside `@rc/lib/env`".
- Evidence / links: `lib/src/env/load.test.ts`.
- Impact on plan: `.env.example` is the reference for variable names and defaults.

## 2026-09-27 · Cloud session hook [M0-03]
- Context: M0-03 says to use the `session-start-hook` skill; that skill is not available in the local Claude Code session that did the task.
- Decision: wrote `.claude/settings.json` (SessionStart, matcher `startup|resume`, 300 s timeout) and `scripts/claude/session-start.sh` by hand. The script exits at once unless `CLAUDE_CODE_REMOTE=true`, so local sessions are untouched. In the cloud it installs the pnpm version from `packageManager` if missing, runs `pnpm install --frozen-lockfile`, and sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` for the session through `CLAUDE_ENV_FILE`. It warns if Node is older than `.nvmrc`.
- Evidence / links: simulated a cloud start on a fresh clone (env vars set by hand): dependencies installed, then `pnpm check` passed; without `CLAUDE_CODE_REMOTE` the script is a no-op. Not yet run in a real cloud session.
- Impact on plan: the "Done when" check (fresh cloud session runs `pnpm check` with no manual steps) is confirmed on the first real cloud session; record the result here.

## 2026-09-27 · CI layout [M0-02]
- Context: 13 §13.7 lists the CI stages; M0-02 asks for static checks and tests now, with stubs for the build, E2E and visual jobs.
- Decision: `ci.yml` runs two blocking jobs, `static` (`biome ci`, typecheck) and `test`, on every PR and on pushes to `main`. The build (M0-08), E2E (M1-25) and dependency-rules (M0-20) stubs are commented out in `ci.yml`. Visual regression (M3-14) will be a separate `visual.yml` with a `templates/**` path filter and a nightly schedule, because a job-level path filter needs an extra action. Action versions: checkout v7, setup-node v7 (Node from `.nvmrc`, pnpm cache), pnpm/action-setup v6 (pnpm version from `packageManager`).
- Evidence / links: latest release tags checked with `gh api` on 2026-09-27.
- Impact on plan: none.

## 2026-09-27 · Toolchain versions and scaffold deviations [M0-01]
- Context: M0-01 asks for current stable pnpm, TypeScript, Biome and Vitest, Node LTS, and a `vitest.workspace.ts`.
- Decision:
  - Versions: pnpm 12.6.0 (`packageManager`), TypeScript 7.0.2 (native compiler), Biome 2.5.14, Vitest 5.0.2, `@types/node` 24. Node 24 LTS in `.nvmrc`; `engines.node` is `>=24`.
  - Vitest 5 no longer supports `vitest.workspace.ts`. Root `vitest.config.ts` lists every package in `test.projects` instead.
  - `@rc/modules` exports only the ten module subpaths (`./core` … `./analytics`) and has no root `src/index.ts` barrel, so callers cannot import the whole domain layer at once. Its test checks that every subpath resolves.
  - Typecheck runs `tsc -p .` per package (`pnpm -r typecheck`) instead of project references; packages have no emit step.
  - `instagram-backup/` (standalone Python tool committed before the plan) stays outside the pnpm workspace and is excluded from Biome.
- Evidence / links: `npm view` on 2026-09-27; Vitest 5 config types expose `test.projects` and no `workspace` option. Vitest 5 `engines` = Node `^22.12 || ^24 || >=26`; `pnpm check` also passes on the owner's local Node 25.2.1, but Node 25 is past end-of-life, so switch the machine to Node 24.
- Impact on plan: 03 §3.1 tree and the M0-01 entry in 15 now name `vitest.config.ts`.

## 2026-09-27 · Work continues from the owner's local folder
- Context: the GitHub repository is public; the spec is an internal document; the owner decided to continue from a local folder and push/PR from there.
- Decision: the plan was delivered as an archive for the local folder instead of being pushed from the cloud session. The spec is stored locally in `docs/spec/` and ignored by `docs/spec/.gitignore`. Making the repository private before the first push is still recommended (B-01, R-17).
- Evidence / links: –
- Impact on plan: `CLAUDE.md`, `03-repository-structure.md`, `README.md` point to the local spec copy.

## 2026-09-27 · Plan v0.1 created
- Context: implementation plan produced from the MVP spec v0.1 (§23).
- Decision: material choices pending confirmation by the owner: D-05 (Trigger.dev), D-08 (Claude `claude-opus-5` for all stages), D-09/D-10 (OpenAI for embeddings and first image adapter), D-11 (inline embeddings), D-13 (Playwright renderer), D-14 (Instagram API with Instagram Login), D-16 (knowledge cards in source language). See 16 §16.5.
- Evidence / links: Meta and Trigger.dev facts in the plan come from secondary sources (official docs were not reachable from the planning environment) and are marked ⚠ V-xx.
- Impact on plan: none yet.
