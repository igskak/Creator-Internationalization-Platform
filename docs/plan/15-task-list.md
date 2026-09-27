# 15 · Dependency-ordered engineering task list

Spec §23.1 item 15 (§23 items 2 and 18). Every task is sized for one Claude Code session and one reviewable PR.

**How to use**
- Pick the first unchecked task whose dependencies are all checked (or the task the user names). Read its **Refs** before coding.
- Keep to the task scope. If you find missing work, add a new task below the current one (e.g. `M1-07a`) instead of widening the PR.
- Finish with the global Definition of Done (14 §14.7): tests, `pnpm check`, tick the box, log deviations in `decision-log.md`.
- Commit message: `type(scope): summary [TASK-ID]`.

**Legend**: P0 = MVP-critical (acceptance path) · P1 = MVP-complete · P2 = post-MVP. Size: S ≈ ≤ ½ day, M ≈ 1 day, L ≈ 2 days (split L if it grows). ⚠ = verify external API details first (16 §16.4). **B-xx** = Track B dependency (14 §14.4).

**Totals**: 127 tasks — 106 P0 (+ M5-12 if legally required), 20 P1 — plus the P2 backlog.

## 15.1 Product areas → epics → features → tasks

| Spec area | Epic | Features | Tasks |
|---|---|---|---|
| Foundation [S§16 Phase 0] | M0 | workspace, CI, cloud sessions, env, logging, errors, crypto, DB, storage, jobs, auth, actions, shell, settings, dev CLI | M0-01 … M0-21 |
| Source Library & Knowledge Engine [S§6] | M1 | upload & rights; parsing to pages; extraction batches; quote/number verification; review & versions; embeddings, dedupe, retrieval; historical posts, gloss, transcription (P1) | M1-01 … M1-25 |
| Content generation workflow [S§7] | M2 | ideas; market adaptation; writing; validators & numeric fidelity; differentiation; critic loop; pipeline job; draft viewer; evals; voice examples (P1); Gate G1 | M2-01 … M2-18 |
| Visual generation & rendering [S§8] | M3 | visual briefs; image provider & normalization; fonts & themes; templates A–F; renderer & QA; preview; visual regression; bake-off; photo library, visual QA (P1) | M3-01 … M3-17 |
| Admin UX & human feedback [S§10] | M0 + M4 | shell & navigation; brand/market settings; review screen; field edit/regenerate; approval snapshots; drafts list | M0-17, M0-18, M4-01 … M4-07 |
| Scheduling [S§11] | M4 | scheduling service with safeguards; calendar | M4-08 … M4-10 |
| Monetization [S§13] | M2 + M4 + M6 | products & offers; campaign IDs, UTM, ManyChat checklist; attribution & commercial dashboard (P1) | M2-02, M4-11, M6-08 |
| Instagram / Meta [S§9] | M5 | verification; OAuth & tokens; callbacks; publish state machine; dispatcher; guards & kill switch; publish UX; smoke test; Gate G2; AI imagery disclosure | M5-00 … M5-12 |
| Analytics [S§12.1–12.3] | M6 | snapshot jobs; metric definitions & queries; dashboards; published list & lineage | M6-01 … M6-07, M6-09 |
| Learning loop [S§12.4] | M7 (P1) | performance memory; generation v2; overuse filter; experiments-lite | M7-01 … M7-06 |
| Security, operations, observability [S§19, §23] | M0 + H | env, logging, crypto, auth, Sentry; health page; security review; runbooks; cost alert; scanning | M0-04 … M0-07, M0-15, M0-19, H-01 … H-06 |
| Seed dataset [S§20] | M1 + M2 (P1) + Track B | historical posts import & annotation; voice examples | M1-22, M1-23, M2-17, B-05, B-06, B-08 |
| Reels [S§14] | P2 | – | P2-01, P2-02 |

## 15.2 Build sequence by folder (what exists after which tasks)

| # | Folder / package (created or extended) | Tasks | Needs |
|---|---|---|---|
| 1 | Root configs; skeletons of every package | M0-01 … M0-03 | – |
| 2 | `lib/src/{env,logging,errors,security}` | M0-04 … M0-07 | 1 |
| 3 | `apps/web` (Next.js, UI kit, health route) | M0-08 | 1 |
| 4 | `db` (client, PGlite test DB, migrations 0000–0001, seeds) | M0-09 … M0-11 | 2 |
| 5 | `modules/src/core`, `lib/src/providers/storage`, `jobs` (runner, queues, hello) | M0-12 … M0-14 | 4 |
| 6 | `apps/web` auth, actions framework, shell, settings; Sentry | M0-15 … M0-19 | 3, 5 |
| 7 | `db` 0002; `modules/src/knowledge/{rights,sources,ingestion}`; sources UI | M1-01 … M1-07 | 5, 6 |
| 8 | `lib/src/providers/llm`, `prompts` foundation, `modules/src/ai` | M1-08 … M1-10 | 2 |
| 9 | `lib/src/providers/embeddings`; `knowledge/{extraction,cards,retrieval,dedupe}`; knowledge UI | M1-11 … M1-19 | 7, 8 |
| 10 | `templates` (metadata only), `modules/src/localization` | M2-03, M2-04, M2-11 | 1, 9 |
| 11 | `db` 0003; `modules/src/offers`; `modules/src/content/{ideas,validation,pipeline}`; ideas and draft UI | M2-01, M2-02, M2-05 … M2-15 | 9, 10 |
| 12 | `evals` | M2-16 | 11 |
| 13 | `db` 0004; `lib/src/providers/image`; `modules/src/visuals`; `templates` components and fonts | M3-01 … M3-17 | 11 |
| 14 | `db` 0005; `content/variants/{state,edit,regenerate,approve}`; `publishing/schedule`; review screen, calendar | M4-01 … M4-11 | 13 |
| 15 | `db` 0006; `modules/src/instagram`; `publishing/{publish-machine,dispatcher,safeguards}`; `scripts/ig-smoke.ts` | M5-00 … M5-12 | 14 |
| 16 | `db` 0007; `modules/src/analytics/{snapshots,slots,queries}`; dashboards, lineage | M6-01 … M6-09 | 15 |
| 17 | `db` 0008; `analytics/summaries`, `analytics/experiments`; prompts v2 | M7-01 … M7-06 | 16 |
| 18 | Health page, runbooks, security scripts, acceptance record | H-01 … H-06 | 15, 16 |

Module dependency rules: 02 §2.4. Critical path and parallel work: 14 §14.6.

---

## M0 · Foundation

- [x] **M0-01 · Workspace scaffold and tooling** · P0 · M · deps: —
  - **Do:** pnpm workspace with packages `apps/web` (placeholder until M0-08), `modules`, `lib`, `db`, `jobs`, `prompts`, `templates`, `evals`. Root `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `biome.json`, `vitest.config.ts` (`test.projects`; see decision log 2026-09-27), `.editorconfig`, `.nvmrc`, `.gitignore` (`.env*` except `.env.example`, `spikes/**/out`, `evals/results`, `node_modules`, `.next`). Each package: `package.json` exporting TS source (`exports` map, subpaths for `modules`), `tsconfig.json`, `src/index.ts`, one trivial test. Root scripts: `check`, `test`, `lint`, `format`, `typecheck`.
  - **Done when:** `pnpm install && pnpm check` passes; README "Getting started" lists the commands.
  - **Refs:** 03 §3.1–3.3.

- [x] **M0-02 · CI pipeline** · P0 · S · deps: M0-01
  - **Do:** `.github/workflows/ci.yml`: pnpm cache, `install --frozen-lockfile`, biome check, typecheck, tests. Leave commented stubs for build, E2E, visual jobs (enabled by later tasks).
  - **Done when:** CI is green on a PR.
  - **Refs:** 13 §13.7.

- [x] **M0-03 · Claude Code on the web: session setup** · P0 · S · deps: M0-01
  - **Do:** use the `session-start-hook` skill. `.claude/settings.json` SessionStart hook → `scripts/claude/session-start.sh` (`pnpm install --frozen-lockfile`; never download browsers). Fill the "Commands" section of `CLAUDE.md`.
  - **Done when:** a fresh cloud session runs `pnpm check` without manual steps.

- [x] **M0-04 · Environment loading and validation** · P0 · S · deps: M0-01
  - **Do:** `lib/src/env/`: Zod schemas per concern (db, supabase, r2, ai, trigger, instagram, security, observability, flags `JOBS_MODE`, `AI_PROVIDER`, `STORAGE_PROVIDER`, `INSTAGRAM_PUBLISH_MODE`). `loadServerEnv()` lists missing/invalid variable *names* only. Production guards: `JOBS_MODE=trigger`, no `E2E_TEST_AUTH_SECRET`. Complete `.env.example` with comments.
  - **Done when:** unit tests for valid, invalid and production-guard cases.
  - **Refs:** 12 §12.2.

- [x] **M0-05 · Logging with redaction** · P0 · S · deps: M0-01
  - **Do:** `lib/src/logging/`: pino factory (JSON), child loggers with context, redact paths, `scrubUrl()` (tokens, OAuth codes, `X-Amz-*`), error serializer, `redact()` for audit data.
  - **Done when:** tests prove tokens, codes, presigned signatures and cookies never reach output.
  - **Refs:** 12 §12.7.

- [x] **M0-06 · Error model** · P0 · S · deps: M0-01
  - **Do:** `lib/src/errors/`: `AppError` (code, message, details, cause), `ValidationError`, `NotFoundError`, `ConflictError`, `InvalidStateError`, `ForbiddenError`, `RightsBlockedError`, `TransientError`, `PermanentError`; `isRetryable()`; `toPublicError()`.
  - **Done when:** unit tests.

- [x] **M0-07 · Crypto utilities** · P0 · S · deps: M0-04
  - **Do:** `lib/src/security/`: AES-256-GCM `encrypt(plain, { aad })` / `decrypt` with key ring and active key id (`enc:v1:…`); HMAC sign/verify with expiry (OAuth state); constant-time compare; Meta `signed_request` parse + verify.
  - **Done when:** tests: round trip, tamper, wrong AAD, old-key decrypt, expired state, bad signature.
  - **Refs:** 12 §12.3.

- [ ] **M0-08 · Next.js app and UI kit** · P0 · M · deps: M0-01 · ⚠ V-21
  - **Do:** create `apps/web` (Next.js current stable, App Router, TS), Tailwind, shadcn/ui with base components (button, input, textarea, select, dialog, sheet, dropdown, tabs, table, badge, card, skeleton, tooltip, popover, form, sonner). `next.config.ts`: `transpilePackages` (workspace packages), `serverExternalPackages` (`sharp`, `playwright-core`), security headers. `/api/health` (static ok). Enable the CI build job.
  - **Done when:** `pnpm --filter @rc/web build` passes locally and in CI.
  - **Refs:** 01 D-02, 12 §12.5.

- [ ] **M0-09 · Database package** · P0 · M · deps: M0-01, M0-04 · ⚠ V-20
  - **Do:** `db/`: drizzle-orm, drizzle-kit, postgres.js. `createDb(url, { pooled })` (`prepare: false` for the pooler). `createTestDb()` = PGlite + vector extension + all migrations. `migrate.ts` (`pnpm db:migrate`). `0000_extensions.sql`. Document Supabase connection strings.
  - **Done when:** a test boots PGlite and runs a cosine query; `pnpm db:migrate` works against dev Supabase (manual, noted in PR).
  - **Refs:** 04 §4.1, §4.7.

- [ ] **M0-10 · Core schema (0001_core)** · P0 · M · deps: M0-09
  - **Do:** Drizzle schema + migration: enums of 0001, `app_users`, `brands`, `markets`, `taxonomy_terms`, `app_settings`, `audit_events`; `set_updated_at()` trigger; RLS enable statements; Zod JSON types (`VisualSystem`, `VocabularyEntry`, `ForbiddenPattern`, `VisualHypothesis`).
  - **Done when:** migration applies on PGlite; round-trip and JSON validation tests.
  - **Refs:** 04 §4.2, §4.3 (0001), §4.4.

- [ ] **M0-11 · Seed script** · P0 · S · deps: M0-10
  - **Do:** idempotent `pnpm db:seed`: Reg.Chef brand (voice placeholder), markets es-ES (active), en (active), fr-FR (inactive) with A-06 defaults, taxonomy (04 §4.7), owners from `SEED_OWNER_EMAILS`, settings (`publishing.enabled=false`, `publishing.min_gap_minutes=180`, `analytics.min_sample=3`, `rights.defaults`).
  - **Done when:** running twice gives identical rows (test).

- [ ] **M0-12 · Core module: context, audit, transitions** · P0 · M · deps: M0-05, M0-06, M0-10
  - **Do:** `modules/src/core/`: `ServiceContext` type + factory, injectable `Clock`, `withTransaction`, `audit(ctx, event)` (redacted), `transition(ctx, { table, id, from[], to, set })` conditional update → `InvalidStateError`.
  - **Done when:** PGlite tests for allowed/refused transitions and audit rows.
  - **Refs:** 02 §2.2, 04 §4.7 rule 6.

- [ ] **M0-13 · Storage provider (R2)** · P0 · M · deps: M0-04 · ⚠ V-22
  - **Do:** `lib/src/providers/storage/`: interface (`presignPut`, `presignGet`, `head`, `getStream`, `getBytes`, `put`, `delete`), R2 adapter (S3 client with R2 endpoint), in-memory fake, key helpers (08 §8.8). Runbook `docs/runbooks/r2-setup.md` (buckets per env, EU jurisdiction, CORS, scoped tokens).
  - **Done when:** contract tests on the fake; optional live test gated by env; runbook written.

- [ ] **M0-14 · Job runner and Trigger.dev setup** · P0 · M · deps: M0-12 · ⚠ V-17
  - **Do:** `jobs/trigger.config.ts` (project, dirs, retry defaults, build extensions placeholder), `jobs/src/queues.ts` (06 §6.1). `modules/src/core/job-runner.ts`: `JobRunner`, `TriggerDevJobRunner` (global-scope idempotency keys), `InlineJobRunner`. `modules/src/job-handlers.ts` registry. `hello` job writing an audit event. Document alert channel setup.
  - **Done when:** inline test triggers `hello` and finds the audit row; in dev, `pnpm jobs:dev` runs it from a dev-only button.
  - **Refs:** 06 §6.1, §6.5.

- [ ] **M0-15 · Authentication** · P0 · M · deps: M0-08, M0-11
  - **Do:** Supabase Auth (magic link, sign-ups off, redirect URLs; note custom SMTP for prod). `@supabase/ssr` clients, `/login`, auth callback, middleware session check for `(app)`, `(app)/layout.tsx` loads `app_users` (link `auth_user_id` on first login; refuse unknown/inactive), `getCurrentUser()`, `requireRole()`, sign-out. Test-login route guarded by `E2E_TEST_AUTH_SECRET` (non-production only).
  - **Done when:** allowlisted email logs in; unknown email refused; unit tests for allowlist and guard.
  - **Refs:** 01 D-07, 12 §12.5.

- [ ] **M0-16 · Server action framework** · P0 · S · deps: M0-12, M0-15
  - **Do:** `defineAction()` (Zod input, auth, roles, request id, ServiceContext, error → `ActionResult`), `useAction()` hook (pending state, toast with request id), `getStatuses` skeleton.
  - **Done when:** unit tests for error mapping and role refusal.
  - **Refs:** 05 §5.1.

- [ ] **M0-17 · App shell and navigation** · P0 · S · deps: M0-15
  - **Do:** `(app)` layout with sidebar (10 §10.1), user menu, banner slot, placeholder pages for every route, France item disabled.
  - **Done when:** all routes render for a logged-in user; logged-out users are redirected.

- [ ] **M0-18 · Brand and market settings** · P0 · M · deps: M0-16, M0-17
  - **Do:** `/settings/brand` (voice guide Markdown editor, visual system JSON editor with Zod errors, taxonomy list), `/markets/[code]` (tone, food culture, vocabulary, forbidden patterns with regex check, visual hypotheses, units, time zone). Actions `updateBrand`, `updateMarket`, `upsertTaxonomyTerm`, `setAppSetting` with audit.
  - **Done when:** edits persist with audit rows; invalid regex rejected (test).
  - **Refs:** 05 §5.2.

- [ ] **M0-19 · Error tracking and request ids** · P0 · S · deps: M0-05, M0-08, M0-14
  - **Do:** Sentry for Next.js (server + client) and jobs; release = git SHA; `beforeSend` with the scrubber; `x-request-id` in middleware → ServiceContext → job payload `meta.requestId`.
  - **Done when:** a test error reaches the dev Sentry project with request id and no secrets (manual); scrubber unit-tested.
  - **Refs:** 12 §12.9.

- [ ] **M0-20 · Module boundary rules** · P1 · S · deps: M0-01
  - **Do:** dependency-cruiser rules from 02 §2.4; CI step.
  - **Done when:** a deliberate forbidden import fails CI.

- [ ] **M0-21 · Dev CLI** · P1 · S · deps: M0-12
  - **Do:** `pnpm rc <command>` (tsx) with a ServiceContext for the dev DB; commands registered by modules later (`rc ingest <file>`, `rc generate <ideaId>`, `rc eval …`).
  - **Done when:** `pnpm rc hello` writes an audit event in dev.

## S · Early spike (parallel with M0)

- [ ] **S-01 · Core AI quality spike (throwaway)** · P0 · M · deps: M0-01, B-03, B-04, B-05
  - **Do:** load the `claude-api` skill. In `spikes/core-loop/`: script that sends 15–30 pages of one real PDF to Claude (PDF input) and extracts cards; pick 5 cards; generate 1 Master Idea; generate ES and EN drafts with simple prompts. Write outputs, tokens, cost and time to `spikes/core-loop/out/` (git-ignored).
  - **Done when:** Ihor and Sergey reviewed the outputs; quality issues, prompt ideas, cost and latency are in `decision-log.md`. No production code imports the spike.
  - **Why:** tests the core product bet in week 1–2 [S§24 priority reminder].

## M1 · Knowledge Engine

- [ ] **M1-01 · Knowledge schema (0002_knowledge)** · P0 · M · deps: M0-10
  - **Do:** schema + migration: `source_assets`, `source_pages`, `source_chunks`, `generation_runs`, `knowledge_extraction_batches`, `knowledge_items`, `knowledge_item_versions`, `historical_posts`; enums; HNSW indexes; Zod JSON types (`RightsPolicy`, `SourceReference`, `ProcedureStep`, `Ingredient`, `Temperature`, `Timing`, `CommonMistake`).
  - **Done when:** migration on PGlite; vector insert + cosine query; JSON validation tests.
  - **Refs:** 04 §4.3 (0002), §4.4.

- [ ] **M1-02 · Rights policy and gates** · P0 · S · deps: M1-01
  - **Do:** `knowledge/rights/`: defaults per source type (from `app_settings`), `assertCanProcessWithAI`, `canVisuallyTransform`, `canUseAsExemplar`.
  - **Done when:** permission matrix tests.
  - **Refs:** 07 §7.13, 12 §12.4.

- [ ] **M1-03 · Source upload backend** · P0 · M · deps: M0-13, M0-16, M1-02
  - **Do:** services + actions `createSourceUpload`, `completeSourceUpload`, `createTextSource`, `updateSourceRights`, `archiveSource`, `getSourceDownloadUrl`; limits (07 §7.2.1); audit; trigger `ingest-source` via JobRunner (handler stub until M1-15).
  - **Done when:** integration tests with fake storage: limits, size mismatch, BLOCKED path, audit rows.
  - **Refs:** 05 §5.3.

- [ ] **M1-04 · Sources UI** · P0 · M · deps: M1-03, M0-17
  - **Do:** `/knowledge/sources` list (status, progress, rights badge, card count); upload dialog (presign → XHR PUT with progress → complete; metadata + rights matrix with explicit choices); `/knowledge/sources/[id]` detail (metadata, owner rights edit, pages preview, batches, errors, reprocess, download).
  - **Done when:** a PDF uploads end to end to dev R2; screenshots in the PR.
  - **Refs:** 10 §10.2.

- [ ] **M1-05 · File sniffing and validation (job side)** · P0 · S · deps: M1-01, M0-13
  - **Do:** `knowledge/ingestion/sniff.ts`: stream to temp file, SHA-256, `file-type` vs declared type, size, PDF checks (encrypted, ≤ 1,000 pages), duplicate checksum, error codes.
  - **Done when:** tests with tiny fixtures (valid PDF, renamed non-PDF, encrypted PDF, DOCX, cp1251 TXT).

- [ ] **M1-06 · PDF page extraction** · P0 · M · deps: M1-05
  - **Do:** `ingestion/pdf.ts`: `unpdf` per-page text, text-layer heuristic, write `source_pages` for the attempt (replace older attempts in one transaction), `page_count`.
  - **Done when:** 3-page fixture (one image-only page) → 3 rows with correct `has_text_layer`.
  - **Refs:** 07 §7.2.2.

- [ ] **M1-07 · DOCX, TXT/MD and transcript extraction** · P0 · M · deps: M1-05
  - **Do:** `ingestion/docx.ts` (mammoth + headings), `text.ts` (UTF-8, cp1251 fallback, Markdown headings), `transcript.ts` (SRT/VTT → segments with `locator`); pseudo-pages ~3,000 chars that never cross a heading; `section_path`.
  - **Done when:** fixture tests per format, incl. Cyrillic and Spanish characters.

- [ ] **M1-08 · LLM provider interface and Anthropic adapter** · P0 · M · deps: M0-04, M0-06 · ⚠ V-18
  - **Do:** load the `claude-api` skill first. `lib/src/providers/llm/`: types (07 §7.3), Anthropic adapter (`messages.parse` + `zodOutputFormat`, streaming path, PDF document blocks, adaptive thinking + effort, no temperature, `stop_reason` handling, refusal fallback as documented, usage incl. cache tokens, error mapping), `FakeLLMProvider`.
  - **Done when:** MSW contract tests (request shape: no temperature, `output_config`, document block; error mapping); fake tests.
  - **Refs:** 07 §7.4.

- [ ] **M1-09 · Prompts package foundation** · P0 · S · deps: M0-01
  - **Do:** `definePrompt`, registry (`id@version`), prompt hash, XML section rendering with escaping, snapshot helper.
  - **Done when:** tests: registry lookup, stable hash, escaping of `<` and `&` in data.
  - **Refs:** 07 §7.5.

- [ ] **M1-10 · runStage and generation logging** · P0 · M · deps: M1-08, M1-09, M1-01
  - **Do:** `modules/src/ai/`: `config.ts` (stage → prompt, model `claude-opus-5`, effort, maxTokens), `version.ts` (`PIPELINE_VERSION`), `cost.ts` (price table), `runStage()` (render → call → Zod + domain validator hook → one repair as a new request → `generation_runs` row with status, usage, cost, latency, input refs, stop reason).
  - **Done when:** fake-provider tests: valid; invalid → repaired; invalid twice → INVALID_OUTPUT; refusal → REFUSED; cost computed.
  - **Refs:** 07 §7.4, §7.5, §7.8.

- [ ] **M1-11 · Embedding provider** · P0 · S · deps: M0-04 · ⚠ V-19
  - **Do:** interface + OpenAI adapter (`text-embedding-3-large`, `dimensions: 1536`, batching, retries) + deterministic fake; `embedTexts()` returns vectors + model + hash.
  - **Done when:** MSW contract test (dimensions param), fake determinism test.

- [ ] **M1-12 · Knowledge extractor prompt v1** · P0 · M · deps: M1-09
  - **Do:** `prompts/src/knowledge-extractor/v1.ts` + schema (07 §7.7) with taxonomy enums built at call time; rules (07 §7.6.4); synthetic Russian culinary fixture pages written for tests + expected-card notes for evals. Use S-01 learnings.
  - **Done when:** prompt snapshot test; fixture output parses; prompt text reviewed by Ihor.

- [ ] **M1-13 · Extraction batches** · P0 · M · deps: M1-06, M1-07, M1-10, M1-12
  - **Do:** `extraction/plan.ts` (15-page PDF_NATIVE batches with 25 MB guard; ~12k-token TEXT batches), `extraction/batch.ts` (sub-PDF with `pdf-lib`, `runStage`, TEXT fallback, idempotent inserts by ordinal, batch status).
  - **Done when:** fake-LLM integration tests: success, PDF failure → TEXT fallback, rerun skips SUCCEEDED batches.
  - **Refs:** 06 J2, 07 §7.2.3.

- [ ] **M1-14 · Quote and number verification** · P0 · M · deps: M1-13
  - **Do:** `extraction/verify-quote.ts` (07 §7.2.4); flags `QUOTE_UNVERIFIED`, `LOW_CONFIDENCE`, `SAFETY_SENSITIVE` (model flag + keyword rules 07 §7.2.7); EXTRACTED → NEEDS_REVIEW.
  - **Done when:** table-driven tests (hyphenation, soft hyphen, ё/е, quotes, fuzzy threshold, number not found).

- [ ] **M1-15 · Ingestion orchestrator (`ingest-source`)** · P0 · M · deps: M1-13, M1-14, M0-14
  - **Do:** handler + Trigger.dev task (06 §6.3 J1): rights gate, sniff, parse, pages, plan, `batchTriggerAndWait` (sequential in inline mode), finalize READY/FAILED with progress JSON, audit; reprocess semantics (attempt + 1; unapproved cards of older attempts → ARCHIVED `SUPERSEDED`).
  - **Done when:** inline integration tests (happy, BLOCKED, one batch failed → READY partial, reprocess); dev run on one real PDF.

- [ ] **M1-16 · Card embeddings and dedupe** · P0 · S · deps: M1-11, M1-15
  - **Do:** `embed-knowledge-items` job (skip if hash unchanged; also the re-embed job for model changes); dedupe suggestions (cosine ≥ 0.92, same language) → `DUPLICATE_SUSPECTED` + `duplicate_of_id`; re-embed on edit/approve.
  - **Done when:** tests with fake embeddings (forced similar pair flagged; unchanged card not re-embedded).

- [ ] **M1-17 · Knowledge Base list UI** · P0 · M · deps: M1-15, M0-16
  - **Do:** `/knowledge/cards`: filters (status, category, source, flags, language), text search, status counts, default review order (07 §7.2.8), bulk approve/archive (`bulkTransitionKnowledgeCards`).
  - **Done when:** 500-card fixture list loads in < 1 s server time; bulk approve skips unverified cards (test).

- [ ] **M1-18 · Knowledge card review UI and versions** · P0 · L · deps: M1-17
  - **Do:** `/knowledge/cards/[id]`: structured editor (procedure, ingredients, temperatures, timings, mistakes), evidence viewer (cited page ± 1, highlighted quote, link to PDF page via presigned URL), flags, version history, transitions (10 §10.4.1) with role guard. Actions `updateKnowledgeCard`, `transitionKnowledgeCard`; `knowledge_item_versions` snapshot on approve; approved-card edit → NEEDS_REVIEW + variant flags hook.
  - **Done when:** the chef approves/edits/archives in the UI; version rows are correct (tests).
  - **Refs:** 05 §5.4.

- [ ] **M1-19 · Retrieval service** · P0 · S · deps: M1-16
  - **Do:** `knowledge/retrieval/`: `candidatePool()` (filters, recent-use exclusion, MMR λ 0.7, ≤ 60), `searchApproved(query)`, `getIdeaCards(ideaId)` (approved snapshots).
  - **Done when:** PGlite tests with fake embeddings (diversity, exclusion).
  - **Refs:** 07 §7.9.1.

- [ ] **M1-20 · Manual cards and duplicate merge** · P1 · S · deps: M1-18
  - **Do:** `createManualKnowledgeCard`, `mergeDuplicateCards` + UI.
  - **Done when:** tests; merge refuses cards used by ideas.

- [ ] **M1-21 · Source chunks and source search** · P1 · M · deps: M1-06, M1-07, M1-11
  - **Do:** page-aware chunker (~800 tokens, 100 overlap), chunk embeddings in `ingest-source`, "search sources" panel in the card editor.
  - **Done when:** deterministic chunk tests; search finds the fixture passage.

- [ ] **M1-22 · Historical posts import** · P1 · M · deps: M1-01, M0-16
  - **Do:** CSV/JSON import (07 §7.2.5) → job J16 → `historical_posts`; `/knowledge/posts` with metrics, annotation editor, exemplar toggle; template CSV in `docs/runbooks/historical-posts.md`.
  - **Done when:** parsing tests (quotes, emojis, Russian text, bad rows reported).

- [ ] **M1-23 · Post annotation suggestions** · P1 · M · deps: M1-22, M1-10
  - **Do:** `post-annotator@1` + job J17 + confirm UI.
  - **Done when:** fake-LLM tests; confirmed annotations are never overwritten.

- [ ] **M1-24 · Scanned-page transcription and card English gloss** · P1 · M · deps: M1-15, M1-18
  - **Do:** `page-transcriber@1` + J19 (pages without text layer → text, then re-verify quotes); `knowledge-gloss@1` + `requestCardGloss` (UI label "not approved text").
  - **Done when:** fake tests; the gloss never appears as approved content.

- [ ] **M1-25 · M1 acceptance** · P0 · S · deps: M1-18, M1-19
  - **Do:** E2E spec 1 (13 §13.4) with fakes; manual run on one real book and one DOCX in dev; record pages, cards, % verified quotes, cost, time, top issues in `decision-log.md`.
  - **Done when:** M1 DoD (14 §14.2) checked.

## M2 · Content Engine → Gate G1

- [ ] **M2-01 · Content schema (0003_content)** · P0 · M · deps: M1-01
  - **Do:** `products`, `offers`, `master_ideas`, `master_idea_knowledge`, `content_variants`, `voice_examples`; FKs on `generation_runs`; JSON types (`Slide`, `CtaSpec`, `UtmSpec`, `MarketBrief`, `CriticReport`, `DifferentiationReport`, `GenerationConfig`, `PipelineState`, `ValidationIssue`).
  - **Done when:** migration + round-trip tests; partial unique index test.
  - **Refs:** 04 §4.3 (0003).

- [ ] **M2-02 · Products and offers** · P0 · M · deps: M2-01, M0-17
  - **Do:** services, actions, `/knowledge/offers` UI (products; offers per market with currency check, priority, default keyword, landing URL).
  - **Done when:** tests; UI works in dev.
  - **Refs:** 05 §5.5.

- [ ] **M2-03 · Template catalog metadata** · P0 · S · deps: M0-01
  - **Do:** `templates/src/define-template.ts` + `registry.ts` with metadata for A–F (08 §8.2.1), no components yet; `validateSlideAgainstTemplate()`; compact catalog text for prompts.
  - **Done when:** tests for limits and required slots.

- [ ] **M2-04 · Units and numeric fidelity** · P0 · M · deps: M0-01
  - **Do:** `localization/units.ts`, `numeric-fidelity.ts` (07 §7.9.3).
  - **Done when:** table-driven tests incl. es-ES and EN formatting, tolerances, ranges.

- [ ] **M2-05 · Content validators** · P0 · M · deps: M2-03, M2-04
  - **Do:** `content/validation/*` (07 §7.8) returning `ValidationIssue[]` with severity; blocking classification.
  - **Done when:** pass/fail tests per validator.

- [ ] **M2-06 · Idea generator prompt v1 and context builder** · P0 · M · deps: M1-19, M1-10
  - **Do:** prompt + schema; context (card digests from `candidatePool`, ideas of the last 60 days, offers by priority, market notes, optional performance memory); post-validation (IDs ⊆ pool, near-duplicate filter vs recent ideas, product exists).
  - **Done when:** fake-LLM tests; prompt snapshot.
  - **Refs:** 07 §7.6, §7.9.1.

- [ ] **M2-07 · Ideas service and job** · P0 · M · deps: M2-06, M2-01
  - **Do:** `generate-ideas` handler + task; actions `generateIdeas`, `createManualIdea`, `updateIdea`, `transitionIdea`; links with approved versions; audit.
  - **Done when:** integration tests (manual idea with a non-approved card refused; generated ideas PROPOSED with links).
  - **Refs:** 05 §5.6.

- [ ] **M2-08 · Ideas UI** · P0 · M · deps: M2-07
  - **Do:** `/content/ideas` (tabs, generate dialog), `/content/ideas/[id]` (detail, linked cards, actions, "Generate ES + EN drafts"), manual idea form with approved-card picker.
  - **Done when:** flows work in dev with fakes; screenshots.

- [ ] **M2-09 · Market adapter prompt v1** · P0 · M · deps: M2-03, M1-10
  - **Do:** prompt + `MarketBrief` schema + validators (5–10 slides, first HOOK, templates exist, IDs ⊆ idea, differs from sibling plan); unit conversion table injected.
  - **Done when:** fake tests; prompt snapshot; es-ES/EN rules reviewed by Ihor (and native reviewers when available).

- [ ] **M2-10 · Content writer prompt v1** · P0 · M · deps: M2-05, M2-09
  - **Do:** prompt + schema (slots as `{ slot, text }[]`), slot limits and exemplar block rendering, repair via `runStage`.
  - **Done when:** fake tests incl. repair after slot overflow.

- [ ] **M2-11 · Cross-market differentiation checker** · P0 · M · deps: M1-11
  - **Do:** `localization/differentiation.ts` (07 §7.10) with thresholds config + version.
  - **Done when:** tests with forced-similar fake embeddings; template-sequence distance tests.

- [ ] **M2-12 · Critic prompt v1 and verdict policy** · P0 · M · deps: M2-05, M2-11
  - **Do:** prompt + schema; `content/pipeline/policy.ts` (07 §7.6.3); quality score.
  - **Done when:** policy table tests; fake critic tests.

- [ ] **M2-13 · Variant generation pipeline** · P0 · L · deps: M2-10, M2-11, M2-12
  - **Do:** `content/pipeline/generate-variants.ts` (07 §7.6.2): locking, shuffled sequential adapters, parallel writers, validation + repair, critic loop (≤ 2 rewrites), persistence of fields/flags/config/`template_sequence`/`content_length`, `pipeline_state` resume, failure handling.
  - **Done when:** integration tests: happy, rewrite, flag, resume after simulated crash, failure → DRAFT + `GENERATION_FAILED`.

- [ ] **M2-14 · `generate-content` job and actions** · P0 · M · deps: M2-13, M0-14
  - **Do:** J5 handler + task; actions `generateVariants`, `regenerateVariant`; `getStatuses` for variants (stage from `pipeline_state`).
  - **Done when:** inline integration test from action to READY_FOR_REVIEW.
  - **Refs:** 06 J5.

- [ ] **M2-15 · Draft viewer v0** · P0 · M · deps: M2-14, M2-08
  - **Do:** `/content/review/[ideaId]` read-only: idea + cards; per market: hook, slides as text cards (template, role, cited cards), caption, CTA, hashtags, critic verdict/scores/issues, flags; differentiation panel; "Regenerate all".
  - **Done when:** usable for G1 review in dev; screenshots.

- [ ] **M2-16 · Eval harness v1** · P0 · M · deps: M2-13
  - **Do:** `evals/`: case format, runner (`pnpm eval`), metrics (07 §7.12), `eval-judge@1`, cost preview + confirmation, results JSON, blind pair export (CSV/Markdown); synthetic sample set.
  - **Done when:** runs with the fake provider in CI (smoke) and with the real provider manually.

- [ ] **M2-17 · Voice examples and few-shot v1** · P1 · S · deps: M2-01, M2-10
  - **Do:** `voice_examples` CRUD + seed import (Sergey's edits), exemplar selection (07 §7.11 v1) incl. rights exclusion.
  - **Done when:** selection tests; the writer receives examples.

- [ ] **M2-18 · Gate G1 run and decision** · P0 · S · deps: M2-15, M2-16, M1-25, B-08, B-09
  - **Do:** 10 ideas × 2 markets on real approved cards; metrics; native reviewers score blind pairs; Ihor/Sergey rate approvability; `docs/decisions/G1.md` with pass/fail per criterion (14 §14.3) and actions.
  - **Done when:** G1 decision recorded.

## M3 · Creative Engine

- [ ] **M3-01 · Creative schema (0004_creative)** · P0 · S · deps: M2-01
  - **Do:** `visual_assets`, `carousel_renders`, `rendered_slides`, `content_variants.current_render_id`; `QaReport` type.
  - **Done when:** migration + tests.

- [ ] **M3-02 · Visual director prompt v1 and pipeline step** · P0 · M · deps: M2-13, M3-01
  - **Do:** prompt + `VisualBrief` schema + validators (slot coverage, library IDs and rights); final pipeline step; persist `visual_brief_json`; action to regenerate the brief.
  - **Done when:** fake tests; pipeline test includes the visual step.
  - **Refs:** 07 §7.6.4.

- [ ] **M3-03 · Image provider (OpenAI) and fake** · P0 · M · deps: M0-04 · ⚠ V-19
  - **Do:** `ImageProvider` interface, OpenAI Images adapter (current gpt-image model, portrait size, quality), fake (gradient PNG with slot label), cost per image.
  - **Done when:** MSW contract test; fake test.

- [ ] **M3-04 · Image normalization and pHash** · P0 · M · deps: M0-13
  - **Do:** `visuals/images/normalize.ts` (auto-orient, sRGB, attention crop to slot aspect, resize, WebP q90, keep original), `phash.ts`, storage keys.
  - **Done when:** fixture tests (dimensions, color space, hash stability).

- [ ] **M3-05 · `generate-visual-assets` job** · P0 · M · deps: M3-02, M3-03, M3-04
  - **Do:** J7: per planned slot → provider → normalize → R2 → `visual_assets`; update slide image slots; per-slot failure with retry action; `VISUAL_MISSING` flag; trigger render.
  - **Done when:** integration test with fakes; idempotent rerun creates no duplicates.
  - **Refs:** 06 J7.

- [ ] **M3-06 · Fonts, theme tokens and glyph checks** · P0 · M · deps: M2-03, B-10
  - **Do:** bundle fonts (WOFF2 + TTF) in `templates/assets/fonts` (brand fonts if licensed, else OFL fallback); theme tokens from `brands.visual_system` + market variant → CSS variables; `glyphs.ts` with fontkit.
  - **Done when:** tests: Spanish/French characters covered; emoji or unsupported char reported.
  - **Refs:** 08 §8.3, §8.6.

- [ ] **M3-07 · Template framework** · P0 · M · deps: M3-06
  - **Do:** `SlideDocument` (1080×1350, safe area, logo anchor, page indicator), `renderSlideHtml(slide, theme, assets)` → full HTML with inline CSS and data-URL fonts/images, `fit-text.client.js`.
  - **Done when:** HTML snapshot test for a fixture slide.
  - **Refs:** 08 §8.2, §8.6.

- [ ] **M3-08 · Templates A and F** · P0 · M · deps: M3-07
  - **Do:** components + styles + fixtures (ES long, EN short, max-length, special characters).
  - **Done when:** fixtures render without overflow in the renderer (after M3-11) — until then HTML snapshots.

- [ ] **M3-09 · Templates B and E** · P0 · M · deps: M3-07
  - **Do:** as M3-08 (B with and without `number`).
  - **Done when:** as M3-08.

- [ ] **M3-10 · Templates C and D** · P1 · M · deps: M3-07
  - **Do:** as M3-08; D uses an icon set in `templates/assets/icons`.
  - **Done when:** as M3-08.

- [ ] **M3-11 · Playwright renderer and render QA** · P0 · M · deps: M3-08
  - **Do:** `visuals/render/renderer.ts` (one Chromium per run, viewport 1080×1350, DPR 1, fonts ready, fit-text, overflow/logo/image checks, PNG → sharp JPEG q90 4:4:4 sRGB, size guard) and `qa.ts`.
  - **Done when:** renders fixtures in CI and in Claude Code (pre-installed Chromium); QA catches a forced overflow.
  - **Refs:** 08 §8.6, §8.7.

- [ ] **M3-12 · `render-carousel` job and auto-trigger** · P0 · M · deps: M3-11, M3-05 · ⚠ V-17
  - **Do:** J8 with the Playwright build extension, `medium-1x` machine, `render` queue; input-hash idempotency; `rendered_slides`; `current_render_id`; flags; debounce on text edits.
  - **Done when:** inline integration test; dev run in Trigger.dev renders a real variant.
  - **Refs:** 06 J8.

- [ ] **M3-13 · Preview: slide route and carousel viewer** · P0 · M · deps: M3-12, M2-15
  - **Do:** `/api/preview/slide` (same HTML as the renderer, draft values allowed, sandboxed iframe); carousel viewer (4:5 frame, swipe, thumbnails, 1:1 zoom, QA badges, stale-render state) in the review screen.
  - **Done when:** live preview matches the JPEG for fixtures; screenshots.
  - **Refs:** 08 §8.5.

- [ ] **M3-14 · Visual regression tests** · P0 · S · deps: M3-09, M3-11
  - **Do:** golden PNGs per template × fixtures; pixelmatch compare; `pnpm test:visual --update`; CI job on `templates/**` changes + nightly.
  - **Done when:** CI job green; a deliberate CSS change fails it.
  - **Refs:** 08 §8.9.

- [ ] **M3-15 · Image model bake-off** · P0 · S · deps: M3-05
  - **Do:** 10 real visual briefs × 2 models (OpenAI + one alternative through a throwaway script); blind review by Ihor/Sergey on a "premium macro food" rubric; `docs/decisions/image-provider.md`; set the default model (add a second adapter task if the alternative wins).
  - **Done when:** decision recorded.

- [ ] **M3-16 · Photo library** · P1 · M · deps: M3-04, M1-04
  - **Do:** PHOTO sources → `visual_assets` (LIBRARY_PHOTO) with tags/description (manual + optional AI tags); rights check; library candidates for the visual director.
  - **Done when:** director can pick a library photo in a test.

- [ ] **M3-17 · Visual QA with vision** · P1 · M · deps: M3-12
  - **Do:** `visual-qa@1` on rendered JPEGs (legibility, AI artifacts, text inside images, brand consistency) → issues added to the critic report; contrast check.
  - **Done when:** fake tests; real run on 5 variants logged.

## M4 · Review + Calendar

- [ ] **M4-01 · Review and scheduling schema (0005)** · P0 · M · deps: M3-01
  - **Do:** `review_events`, `content_variant_versions`, `social_accounts`, `publications`; `content_variants.approved_version_id`; `voice_examples` FK; `ApprovedSnapshot`, `InstagramError` types.
  - **Done when:** migration + tests (partial unique indexes).
  - **Refs:** 04 §4.3 (0005).

- [ ] **M4-02 · Variant state machine** · P0 · M · deps: M4-01
  - **Do:** `content/variants/state.ts`: transition table (10 §10.4.3), guards, side-effect hooks, "allowed actions" for the UI.
  - **Done when:** full transition matrix tests.

- [ ] **M4-03 · Field paths and edit service** · P0 · M · deps: M4-02, M3-12
  - **Do:** `FieldPath` parse/get/set, per-field validation (template limits, caption, hashtags), optimistic locking, `review_events` (original vs edited), approval invalidation (cancel open publication, audit), debounced re-render; action `editVariantField`.
  - **Done when:** tests: edit, CONFLICT on stale lock, invalidation cancels a scheduled publication.
  - **Refs:** 04 §4.4 FieldPath, 05 §5.7.

- [ ] **M4-04 · Field regeneration** · P0 · M · deps: M4-03
  - **Do:** `field-regenerator@1` + J6 + action `regenerateVariantField`; review event REGENERATE; validators; re-render.
  - **Done when:** fake tests for hook, slide, caption, CTA, image slot.

- [ ] **M4-05 · Review screen v1** · P0 · L · deps: M4-03, M4-04, M3-13
  - **Do:** full UX (10 §10.3): inline edit + regenerate per field with instruction and reason code, keep/undo, slide drawer with live preview, critic panel with jump-to-field, knowledge references, conflict handling, allowed-actions driven buttons.
  - **Done when:** manual walkthrough in dev; screenshots; component tests for key interactions.

- [ ] **M4-06 · Approve, reject, request changes, unapprove** · P0 · M · deps: M4-02, M4-05
  - **Do:** actions with guards (current READY render, blocking flags, checklists, offer for commercial intent); `content_variant_versions` snapshot with content hash and render; dialogs; audit.
  - **Done when:** tests for every guard; snapshot equals render hash.

- [ ] **M4-07 · Drafts list and dashboard counters** · P0 · S · deps: M4-02
  - **Do:** `/content/drafts` table and filters; nav badges; dashboard counters (10 §10.2).
  - **Done when:** counts match fixture data.

- [ ] **M4-08 · Scheduling service** · P0 · M · deps: M4-06
  - **Do:** `publishing/schedule.ts`: `schedulePublication`, `reschedulePublication`, `cancelPublication` (05 §5.8), idempotency key, min-gap warning, market-time-zone handling, audit.
  - **Done when:** tests (past time refused, second live publication refused, cancel restores APPROVED).

- [ ] **M4-09 · Calendar UI** · P0 · M · deps: M4-08
  - **Do:** `/content/calendar` week grid (market colors/flags), list view, "approved, not scheduled" sidebar, schedule dialog (market time zone), status and warnings.
  - **Done when:** schedule/reschedule/cancel work in dev; screenshots.

- [ ] **M4-10 · Review → schedule E2E** · P0 · S · deps: M4-09
  - **Do:** E2E spec 3 (13 §13.4).
  - **Done when:** green in CI.

- [ ] **M4-11 · Campaign IDs, UTM links and ManyChat checklist** · P0 · S · deps: M4-06, M2-02
  - **Do:** `offers/campaigns.ts` (`rc-{market}-{yymmdd}-{6}` at approval of commercial variants), `offers/utm.ts`, review-screen panel with copyable keyword, DM link and flow name; checklist item "ManyChat flow set up" for keyword CTAs.
  - **Done when:** tests (format, uniqueness, UTM encoding); panel visible.
  - **Refs:** 11 §11.7.

## M5 · Instagram → Gate G2

- [ ] **M5-00 · Meta verification pass** · P0 · S · deps: B-11, B-14
  - **Do:** check V-01 … V-16 against the official docs ([S§24] links); record findings and plan changes in `decision-log.md`; update 09 if needed. Needs network access to `developers.facebook.com` (B-14) or run locally.
  - **Done when:** every ⚠ Meta item has a verified value or a documented decision.

- [ ] **M5-01 · Instagram module foundation (+ 0006)** · P0 · M · deps: M4-01, M0-07, M5-00
  - **Do:** migration 0006 (`publish_attempts`, `integration_events`); `instagram/http.ts` (timeouts, JSON, error normalization, path-only logging, token transport), `errors.ts` (09 §9.4.4), config (`META_GRAPH_API_VERSION`, `INSTAGRAM_GRAPH_BASE_URL` — points to the mock Graph API in E2E), MSW fixtures for every call and error class (also served over HTTP as the E2E mock).
  - **Done when:** classification tests; wrapper never logs tokens (test).

- [ ] **M5-02 · OAuth connect flow** · P0 · M · deps: M5-01, M0-15
  - **Do:** `/api/instagram/oauth/start` and `/callback` (09 §9.2): state cookie + HMAC, code → short → long-lived token, `/me`, professional check, market binding check, encryption (AAD = row id), audit.
  - **Done when:** MSW tests: happy, tampered state, expired state, non-professional account, account bound to another market.

- [ ] **M5-03 · Settings → Instagram UI and banners** · P0 · S · deps: M5-02
  - **Do:** `/settings/instagram` per market (connect/reconnect/disconnect, token status and expiry, quota, last publish, last error); app-shell banners (NEEDS_REAUTH, expiring < 7 days).
  - **Done when:** states render from fixtures; screenshots.

- [ ] **M5-04 · Token refresh and account health jobs** · P0 · M · deps: M5-02, M0-14
  - **Do:** J13 and J14 (06 §6.3), `integration_events`, status transitions (VALID/EXPIRING/INVALID).
  - **Done when:** MSW tests (refresh ok, 190 → NEEDS_REAUTH, not refreshed if < 24 h old).

- [ ] **M5-05 · Meta callbacks** · P0 · S · deps: M5-02 · ⚠ V-13
  - **Do:** `/api/meta/deauthorize` and `/api/meta/data-deletion` with `signed_request` verification; status page for deletion codes.
  - **Done when:** tests with signed fixtures (valid, invalid signature).

- [ ] **M5-06 · Publish state machine** · P0 · L · deps: M5-01, M4-08
  - **Do:** `publishing/publish-machine.ts` (09 §9.4): steps, persisted progress, safeguards, presigned URLs for renders, reconciliation, dry run, `publish_attempts` per call.
  - **Done when:** MSW tests for every path in 13 §13.3 (incl. crash after `media_publish` → no second publish, wrong-market account refused).

- [ ] **M5-07 · Dispatcher and publish task** · P0 · M · deps: M5-06
  - **Do:** J9 cron (SKIP LOCKED claim, kill switch, stuck recovery) and J10 (queue per account, retries, `AbortTaskRunError` on permanent errors, global idempotency key); `retryPublication`; concurrency test on real Postgres (CI service container).
  - **Done when:** tests: one claim per publication under parallel dispatchers; retry creates a new key.

- [ ] **M5-08 · Environment guards and kill switch** · P0 · S · deps: M5-07
  - **Do:** `INSTAGRAM_PUBLISH_MODE`, `INSTAGRAM_ACCOUNT_ALLOWLIST`, `setPublishingEnabled` (owner, audited), header indicator.
  - **Done when:** tests: `off` blocks, `dry_run_only` blocks live, unknown account refused.

- [ ] **M5-09 · Publish UX** · P0 · M · deps: M5-07, M4-09
  - **Do:** "Publish now", "Schedule", "Dry run" in review and calendar; publication drawer (attempt timeline, readable errors with next steps, permalink); retry/cancel.
  - **Done when:** flows work against MSW-backed dev; screenshots.

- [ ] **M5-10 · Smoke script and runbook** · P0 · S · deps: M5-07
  - **Do:** `scripts/ig-smoke.ts` (`pnpm ig:smoke --account <id> [--live]`) and `docs/runbooks/instagram-smoke.md` (13 §13.6).
  - **Done when:** dry-run smoke passes on a test account (manual, logged).

- [ ] **M5-11 · Gate G2 and first live posts** · P0 · S · deps: M5-08, M5-09, M5-10, B-12, B-13
  - **Do:** run G2 checklist (14 §14.3): live smoke on test account, idempotency drill, dry runs on production accounts, kill switch, token refresh; first 3 posts per market with Sergey's approval; `docs/decisions/G2.md`.
  - **Done when:** G2 recorded; first production posts have media ids and permalinks.

- [ ] **M5-12 · AI imagery disclosure option** · P0 if B-13 requires it, else P1 · S · deps: M3-05, B-13 · ⚠ V-16
  - **Do:** per-market setting `ai_imagery_disclosure` = `NONE | CAPTION_NOTE | SLIDE_BADGE` (and platform label if the API supports it); applied when a variant uses generated photo-realistic images.
  - **Done when:** tests; the reviewer sees what will be added.

## M6 · Analytics

- [ ] **M6-01 · Analytics schema (0007) and views** · P0 · M · deps: M5-01
  - **Do:** `metric_snapshots`, `account_metric_snapshots`, `attribution_events`; views `v_publication_dimensions`, `v_publication_metrics_d7`, `v_campaign_attribution` (11 §11.3).
  - **Done when:** view tests on fixture data (D7 choice, fallback to D3, dayparts in market time zone).

- [ ] **M6-02 · Insights client** · P0 · M · deps: M5-01 · ⚠ V-10, V-11
  - **Do:** media and account insights calls; metric list per media type; unsupported-metric handling with cached availability; mapping to columns; raw storage.
  - **Done when:** MSW tests (full response, unsupported metric, missing values stay null).

- [ ] **M6-03 · Snapshot jobs** · P0 · M · deps: M6-01, M6-02
  - **Do:** `analytics/slots.ts` (due-slot computation), J11 and J12, `collectMetricsNow` action, `integration_events` on errors.
  - **Done when:** tests: one snapshot per slot, late slot stored with real age, one failing post does not block others.

- [ ] **M6-04 · Metric definitions and query layer** · P0 · M · deps: M6-01
  - **Do:** `analytics/queries/`: rates, D7 standardization, dimension grouping (whitelisted dimensions), min sample, lift, Operations metrics from `review_events`/`audit_events`/`generation_runs`.
  - **Done when:** PGlite tests on a fixture dataset with known answers.

- [ ] **M6-05 · Dashboard: Growth and Engagement** · P0 · M · deps: M6-04
  - **Do:** load the `dataviz` skill; tiles, followers/reach series, non-follower share, per-post rates table; market and date filters.
  - **Done when:** renders fixture data; screenshots.

- [ ] **M6-06 · Dashboard: Content learning** · P0 · M · deps: M6-04
  - **Do:** dimension selector, grouped table (n, medians, lift, low-sample badge), top/bottom posts with thumbnails linking to lineage.
  - **Done when:** fixture results match the query tests.

- [ ] **M6-07 · Dashboard: Operations** · P0 · S · deps: M6-04
  - **Do:** generated, approval rate, rejection reasons, edits per approved variant, time to approve, critic first-pass rate, regenerations, AI cost per approved post.
  - **Done when:** fixture results correct.

- [ ] **M6-08 · Attribution events and Commercial dashboard** · P1 · M · deps: M4-11, M6-04
  - **Do:** manual entry + CSV import (J18), reconciliation list for unknown campaign ids, Commercial tab (leads, sales, revenue, revenue per 1,000 reach).
  - **Done when:** import tests (dedupe by `external_ref`); fixture dashboard.

- [ ] **M6-09 · Published list and lineage view** · P0 · M · deps: M6-03
  - **Do:** `/content/published` (D7 rates, permalink, CSV export) and `/content/published/[id]` lineage (04 §4.6) with metrics timeline and review history.
  - **Done when:** lineage shows source → cards → idea → brief → version → publication → metrics for a fixture post.

## M7 · Learning (P1)

- [ ] **M7-01 · Learning schema (0008)** · P1 · S · deps: M6-01
  - **Do:** `performance_summaries`, `experiments`, variant experiment columns, `master_ideas.performance_summary_id`.
  - **Done when:** migration + tests.

- [ ] **M7-02 · Performance summary builder** · P1 · M · deps: M6-04, M7-01
  - **Do:** `analytics/summaries/` algorithm (11 §11.5), JSON ≤ ~1,500 tokens, caveats.
  - **Done when:** fixture tests (patterns, overuse, gaps, empty-pattern case below data threshold).

- [ ] **M7-03 · Summary job and view** · P1 · S · deps: M7-02
  - **Do:** J15 (weekly + manual + stale-before-ideas), Analytics → Learning summary view.
  - **Done when:** job test; view renders.

- [ ] **M7-04 · Learning into generation (v2 prompts)** · P1 · M · deps: M7-03, M2-16
  - **Do:** `idea-generator@2` (performance memory rules), `content-writer@2` (hook guidance, rejection digest, exemplars by D7); set `performance_summary_id`; eval v1 vs v2; bump `PIPELINE_VERSION` only if no regression.
  - **Done when:** eval results logged; activation decision in `decision-log.md`.

- [ ] **M7-05 · Overuse filter and idea diversity** · P1 · S · deps: M7-02
  - **Do:** deterministic pre-filter in the candidate pool (penalize overused categories/angles); MMR over proposed core messages.
  - **Done when:** tests on fixture history.

- [ ] **M7-06 · Experiments-lite** · P1 · M · deps: M7-01, M6-04
  - **Do:** `/experiments` CRUD, arm assignment on the review screen, results (n, medians, Mann–Whitney U when both arms reach the minimum), completion updates visual hypothesis status.
  - **Done when:** tests for "insufficient data" and result math.

## H · Hardening and MVP acceptance

- [ ] **H-01 · Health page and dashboard indicators** · P0 · M · deps: M5-04, M6-03
  - **Do:** `getSystemHealth` + `/settings/health` + dashboard tiles (12 §12.9 table), stuck detectors, kill switch control.
  - **Done when:** each indicator turns amber/red on fixture conditions (tests).

- [ ] **H-02 · Security review** · P0 · S · deps: M5-02
  - **Do:** RLS check with the anon key (script), headers check, secrets inventory vs 12 §12.2, `scripts/reencrypt-tokens.ts` (key rotation), redaction spot-check of real logs, Claude Code environment has dev keys only.
  - **Done when:** checklist in `docs/runbooks/security-review.md` completed with evidence.

- [ ] **H-03 · Runbooks** · P0 · S · deps: M5-11
  - **Do:** publishing incident, token re-auth, re-ingestion, prompt rollout/rollback, cost spike, secret rotation.
  - **Done when:** runbooks reviewed by Ihor.

- [ ] **H-04 · MVP acceptance run and sign-off** · P0 · S · deps: all P0 tasks
  - **Do:** run 13 §13.8 (spec §17 and §18) with evidence links; sign-off by Ihor and Sergey in `docs/decisions/mvp-acceptance.md`.
  - **Done when:** signed off.

- [ ] **H-05 · AI cost view and budget alert** · P1 · S · deps: M1-10
  - **Do:** `/settings/ai` (stage config read-only, cost month-to-date by stage), `ai.monthly_budget_usd` with amber/red health states and an email alert.
  - **Done when:** fixture costs aggregate correctly.

- [ ] **H-06 · Uptime monitor, secret scanning, dependency audit** · P1 · S · deps: M0-02
  - **Do:** uptime check on `/api/health`; `gitleaks` and `pnpm audit` in CI (audit as warning).
  - **Done when:** CI shows the new checks.

## P2 · Post-MVP backlog (not scheduled)
- **P2-01** Reels Type A: transcription provider, localized subtitles/script, ffmpeg render (Trigger.dev ffmpeg extension), REELS publishing [S§14.1].
- **P2-02** Reels Type B: faceless B-roll + typography + localized voice-over [S§14.2].
- **P2-03** France market activation (fr-FR profile, reviewers, account) [S§1.2].
- **P2-04** ManyChat API integration (automatic flows per campaign).
- **P2-05** Sales webhooks from the selling/payment stack.
- **P2-06** External research knowledge workflow (flagged, human-reviewed) [S§6.3].
- **P2-07** Realtime job progress (Trigger.dev realtime hooks) instead of polling.
- **P2-08** Batch API for bulk (re-)extraction (lower cost).
- **P2-09** 3:4 export experiment if the API supports it.
- **P2-10** Experiments with automatic allocation.
- **P2-11** Calendar drag & drop and best-time suggestions.
- **P2-12** Prompt / stage configuration UI with eval gate.
- **P2-13** Comment ingestion for learning (needs comments scope + webhooks).
- **P2-14** Single-image posts and Stories.
- **P2-15** Eval dataset builder from `review_events`.
- **P2-16** Storage cleanup and retention jobs; log drain.
- **P2-17** Several accounts per market; collaborator posts.
