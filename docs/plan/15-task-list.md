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
| Reels [S§14] | M8 (video-first, on demand, with publishing) + P2 (transcription-based Type A, voice-over Type B) | Reel provider, director prompt, assembly, job, UI, audio, publishing, insights | M8-01 … M8-11, P2-01, P2-02 |

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
| 16 | `db` 0007; `modules/src/analytics/{snapshots,slots,queries}`; dashboards, lineage; progress of long actions | M6-01 … M6-10 | 15 |
| 17 | `db` 0008; `analytics/summaries`, `analytics/experiments`; prompts v2 | M7-01 … M7-06 | 16 |
| 18 | Health page, runbooks, security scripts, acceptance record | H-01 … H-06 | 15, 16 |
| 19 | `db` 0009; `lib/src/providers/video`; `prompts/src/reel-director`; `modules/src/reels`; `jobs` J23; Reel card on review and published screens; `modules/instagram` REELS | M8-01 … M8-11 | 15, 16 |

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

- [x] **M0-08 · Next.js app and UI kit** · P0 · M · deps: M0-01 · ⚠ V-21
  - **Do:** create `apps/web` (Next.js current stable, App Router, TS), Tailwind, shadcn/ui with base components (button, input, textarea, select, dialog, sheet, dropdown, tabs, table, badge, card, skeleton, tooltip, popover, form, sonner). `next.config.ts`: `transpilePackages` (workspace packages), `serverExternalPackages` (`sharp`, `playwright-core`), security headers. `/api/health` (static ok). Enable the CI build job.
  - **Done when:** `pnpm --filter @rc/web build` passes locally and in CI.
  - **Refs:** 01 D-02, 12 §12.5.

- [x] **M0-09 · Database package** · P0 · M · deps: M0-01, M0-04 · ⚠ V-20
  - **Do:** `db/`: drizzle-orm, drizzle-kit, postgres.js. `createDb(url, { pooled })` (`prepare: false` for the pooler). `createTestDb()` = PGlite + vector extension + all migrations. `migrate.ts` (`pnpm db:migrate`). `0000_extensions.sql`. Document Supabase connection strings.
  - **Done when:** a test boots PGlite and runs a cosine query; `pnpm db:migrate` works against dev Supabase (manual, noted in PR).
  - **Refs:** 04 §4.1, §4.7.

- [x] **M0-10 · Core schema (0001_core)** · P0 · M · deps: M0-09
  - **Do:** Drizzle schema + migration: enums of 0001, `app_users`, `brands`, `markets`, `taxonomy_terms`, `app_settings`, `audit_events`; `set_updated_at()` trigger; RLS enable statements; Zod JSON types (`VisualSystem`, `VocabularyEntry`, `ForbiddenPattern`, `VisualHypothesis`).
  - **Done when:** migration applies on PGlite; round-trip and JSON validation tests.
  - **Refs:** 04 §4.2, §4.3 (0001), §4.4.

- [x] **M0-11 · Seed script** · P0 · S · deps: M0-10
  - **Do:** idempotent `pnpm db:seed`: brand (voice placeholder), markets es-ES (active), en (active), fr-FR (inactive) with A-06 defaults, taxonomy (04 §4.7), owners from `SEED_OWNER_EMAILS`, settings (`publishing.enabled=false`, `publishing.min_gap_minutes=180`, `analytics.min_sample=3`, `rights.defaults`).
  - **Done when:** running twice gives identical rows (test).

- [x] **M0-12 · Core module: context, audit, transitions** · P0 · M · deps: M0-05, M0-06, M0-10
  - **Do:** `modules/src/core/`: `ServiceContext` type + factory, injectable `Clock`, `withTransaction`, `audit(ctx, event)` (redacted), `transition(ctx, { table, id, from[], to, set })` conditional update → `InvalidStateError`.
  - **Done when:** PGlite tests for allowed/refused transitions and audit rows.
  - **Refs:** 02 §2.2, 04 §4.7 rule 6.

- [x] **M0-13 · Storage provider (R2)** · P0 · M · deps: M0-04 · ⚠ V-22
  - **Do:** `lib/src/providers/storage/`: interface (`presignPut`, `presignGet`, `head`, `getStream`, `getBytes`, `put`, `delete`), R2 adapter (S3 client with R2 endpoint), in-memory fake, key helpers (08 §8.8). Runbook `docs/runbooks/r2-setup.md` (buckets per env, EU jurisdiction, CORS, scoped tokens).
  - **Done when:** contract tests on the fake; optional live test gated by env; runbook written.

- [x] **M0-14 · Job runner and Trigger.dev setup** · P0 · M · deps: M0-12 · ⚠ V-17
  - **Do:** `jobs/trigger.config.ts` (project, dirs, retry defaults, build extensions placeholder), `jobs/src/queues.ts` (06 §6.1). `modules/src/core/job-runner.ts`: `JobRunner`, `TriggerDevJobRunner` (global-scope idempotency keys), `InlineJobRunner`. `modules/src/job-handlers.ts` registry. `hello` job writing an audit event. Document alert channel setup.
  - **Done when:** inline test triggers `hello` and finds the audit row; in dev, `pnpm jobs:dev` runs it from a dev-only button.
  - **Refs:** 06 §6.1, §6.5.

- [x] **M0-14a · Dev-only "run hello job" button** · P1 · S · deps: M0-14, M0-16, M0-17
  - **Do:** dev-only page or shell action (`APP_ENV=development`) that triggers `hello` through `ctx.jobs` and shows the run id; hidden and refused in production.
  - **Done when:** clicking it in `pnpm dev` + `pnpm jobs:dev` writes a `job.hello` audit row. (Split from M0-14: the button needs auth and the action framework; M0-14 verifies the same path with `pnpm jobs:hello`.)

- [x] **M0-15 · Authentication** · P0 · M · deps: M0-08, M0-11
  - **Do:** Supabase Auth (magic link, sign-ups off, redirect URLs; note custom SMTP for prod). `@supabase/ssr` clients, `/login`, auth callback, middleware session check for `(app)`, `(app)/layout.tsx` loads `app_users` (link `auth_user_id` on first login; refuse unknown/inactive), `getCurrentUser()`, `requireRole()`, sign-out. Test-login route guarded by `E2E_TEST_AUTH_SECRET` (non-production only).
  - **Done when:** allowlisted email logs in; unknown email refused; unit tests for allowlist and guard.
  - **Refs:** 01 D-07, 12 §12.5.

- [x] **M0-16 · Server action framework** · P0 · S · deps: M0-12, M0-15
  - **Do:** `defineAction()` (Zod input, auth, roles, request id, ServiceContext, error → `ActionResult`), `useAction()` hook (pending state, toast with request id), `getStatuses` skeleton.
  - **Done when:** unit tests for error mapping and role refusal.
  - **Refs:** 05 §5.1.

- [x] **M0-17 · App shell and navigation** · P0 · S · deps: M0-15
  - **Do:** `(app)` layout with sidebar (10 §10.1), user menu, banner slot, placeholder pages for every route, France item disabled.
  - **Done when:** all routes render for a logged-in user; logged-out users are redirected.

- [x] **M0-18 · Brand and market settings** · P0 · M · deps: M0-16, M0-17
  - **Do:** `/settings/brand` (voice guide Markdown editor, visual system JSON editor with Zod errors, taxonomy list), `/markets/[code]` (tone, food culture, vocabulary, forbidden patterns with regex check, visual hypotheses, units, time zone). Actions `updateBrand`, `updateMarket`, `upsertTaxonomyTerm`, `setAppSetting` with audit.
  - **Done when:** edits persist with audit rows; invalid regex rejected (test).
  - **Refs:** 05 §5.2.

- [x] **M0-19 · Error tracking and request ids** · P0 · S · deps: M0-05, M0-08, M0-14
  - **Do:** Sentry for Next.js (server + client) and jobs; release = git SHA; `beforeSend` with the scrubber; `x-request-id` in middleware → ServiceContext → job payload `meta.requestId`.
  - **Done when:** a test error reaches the dev Sentry project with request id and no secrets (manual); scrubber unit-tested.
  - **Refs:** 12 §12.9.

- [x] **M0-20 · Module boundary rules** · P1 · S · deps: M0-01
  - **Do:** dependency-cruiser rules from 02 §2.4; CI step.
  - **Done when:** a deliberate forbidden import fails CI.

- [x] **M0-21 · Dev CLI** · P1 · S · deps: M0-12
  - **Do:** `pnpm rc <command>` (tsx) with a ServiceContext for the dev DB; commands registered by modules later (`rc ingest <file>`, `rc generate <ideaId>`, `rc eval …`).
  - **Done when:** `pnpm rc hello` writes an audit event in dev.

## S · Early spike (parallel with M0)

- [x] **S-01 · Core AI quality spike (throwaway)** · P0 · M · deps: M0-01, B-03, B-04, B-05
  - **Do:** load the `claude-api` skill. In `spikes/core-loop/`: script that sends 15–30 pages of one real PDF to Claude (PDF input) and extracts cards; pick 5 cards; generate 1 Master Idea; generate ES and EN drafts with simple prompts. Write outputs, tokens, cost and time to `spikes/core-loop/out/` (git-ignored).
  - **Done when:** Ihor and Sergey reviewed the outputs; quality issues, prompt ideas, cost and latency are in `decision-log.md`. No production code imports the spike.
  - **Why:** tests the core product bet in week 1–2 [S§24 priority reminder].

## M1 · Knowledge Engine

- [x] **M1-01 · Knowledge schema (0002_knowledge)** · P0 · M · deps: M0-10
  - **Do:** schema + migration: `source_assets`, `source_pages`, `source_chunks`, `generation_runs`, `knowledge_extraction_batches`, `knowledge_items`, `knowledge_item_versions`, `historical_posts`; enums; HNSW indexes; Zod JSON types (`RightsPolicy`, `SourceReference`, `ProcedureStep`, `Ingredient`, `Temperature`, `Timing`, `CommonMistake`).
  - **Done when:** migration on PGlite; vector insert + cosine query; JSON validation tests.
  - **Refs:** 04 §4.3 (0002), §4.4.

- [x] **M1-02 · Rights policy and gates** · P0 · S · deps: M1-01
  - **Do:** `knowledge/rights/`: defaults per source type (from `app_settings`), `assertCanProcessWithAI`, `canVisuallyTransform`, `canUseAsExemplar`.
  - **Done when:** permission matrix tests.
  - **Refs:** 07 §7.13, 12 §12.4.

- [x] **M1-03 · Source upload backend** · P0 · M · deps: M0-13, M0-16, M1-02
  - **Do:** services + actions `createSourceUpload`, `completeSourceUpload`, `createTextSource`, `updateSourceRights`, `archiveSource`, `getSourceDownloadUrl`; limits (07 §7.2.1); audit; trigger `ingest-source` via JobRunner (handler stub until M1-15).
  - **Done when:** integration tests with fake storage: limits, size mismatch, BLOCKED path, audit rows.
  - **Refs:** 05 §5.3.

- [x] **M1-04 · Sources UI** · P0 · M · deps: M1-03, M0-17
  - **Do:** `/knowledge/sources` list (status, progress, rights badge, card count); upload dialog (presign → XHR PUT with progress → complete; metadata + rights matrix with explicit choices); `/knowledge/sources/[id]` detail (metadata, owner rights edit, pages preview, batches, errors, reprocess, download).
  - **Done when:** a PDF uploads end to end to dev R2; screenshots in the PR.
  - **Refs:** 10 §10.2.

- [x] **M1-05 · File sniffing and validation (job side)** · P0 · S · deps: M1-01, M0-13
  - **Do:** `knowledge/ingestion/sniff.ts`: stream to temp file, SHA-256, `file-type` vs declared type, size, PDF checks (encrypted, ≤ 1,000 pages), duplicate checksum, error codes.
  - **Done when:** tests with tiny fixtures (valid PDF, renamed non-PDF, encrypted PDF, DOCX, cp1251 TXT).

- [x] **M1-06 · PDF page extraction** · P0 · M · deps: M1-05
  - **Do:** `ingestion/pdf.ts`: `unpdf` per-page text, text-layer heuristic, write `source_pages` for the attempt (replace older attempts in one transaction), `page_count`.
  - **Done when:** 3-page fixture (one image-only page) → 3 rows with correct `has_text_layer`.
  - **Refs:** 07 §7.2.2.

- [x] **M1-07 · DOCX, TXT/MD and transcript extraction** · P0 · M · deps: M1-05
  - **Do:** `ingestion/docx.ts` (mammoth + headings), `text.ts` (UTF-8, cp1251 fallback, Markdown headings), `transcript.ts` (SRT/VTT → segments with `locator`); pseudo-pages ~3,000 chars that never cross a heading; `section_path`.
  - **Done when:** fixture tests per format, incl. Cyrillic and Spanish characters.

- [x] **M1-08 · LLM provider interface and Anthropic adapter** · P0 · M · deps: M0-04, M0-06 · ⚠ V-18
  - **Do:** load the `claude-api` skill first. `lib/src/providers/llm/`: types (07 §7.3), Anthropic adapter (`messages.parse` + `zodOutputFormat`, streaming path, PDF document blocks, adaptive thinking + effort, no temperature, `stop_reason` handling, refusal fallback as documented, usage incl. cache tokens, error mapping), `FakeLLMProvider`.
  - **Done when:** MSW contract tests (request shape: no temperature, `output_config`, document block; error mapping); fake tests.
  - **Refs:** 07 §7.4.

- [x] **M1-09 · Prompts package foundation** · P0 · S · deps: M0-01
  - **Do:** `definePrompt`, registry (`id@version`), prompt hash, XML section rendering with escaping, snapshot helper.
  - **Done when:** tests: registry lookup, stable hash, escaping of `<` and `&` in data.
  - **Refs:** 07 §7.5.

- [x] **M1-10 · runStage and generation logging** · P0 · M · deps: M1-08, M1-09, M1-01
  - **Do:** `modules/src/ai/`: `config.ts` (stage → prompt, model `claude-opus-5-5`, effort, maxTokens), `version.ts` (`PIPELINE_VERSION`), `cost.ts` (price table), `runStage()` (render → call → Zod + domain validator hook → one repair as a new request → `generation_runs` row with status, usage, cost, latency, input refs, stop reason).
  - **Done when:** fake-provider tests: valid; invalid → repaired; invalid twice → INVALID_OUTPUT; refusal → REFUSED; cost computed.
  - **Refs:** 07 §7.4, §7.5, §7.8.

- [x] **M1-11 · Embedding provider** · P0 · S · deps: M0-04 · ⚠ V-19
  - **Do:** interface + OpenAI adapter (`text-embedding-3-large`, `dimensions: 1536`, batching, retries) + deterministic fake; `embedTexts()` returns vectors + model + hash.
  - **Done when:** MSW contract test (dimensions param), fake determinism test.

- [x] **M1-12 · Knowledge extractor prompt v1** · P0 · M · deps: M1-09
  - **Do:** `prompts/src/knowledge-extractor/v1.ts` + schema (07 §7.7) with taxonomy enums built at call time; rules (07 §7.6.4); synthetic Russian culinary fixture pages written for tests + expected-card notes for evals. Use S-01 learnings.
  - **Done when:** prompt snapshot test; fixture output parses; prompt text reviewed by Ihor. *(Ihor reviewed the prompt text on 2026-10-03: ok.)*

- [x] **M1-13 · Extraction batches** · P0 · M · deps: M1-06, M1-07, M1-10, M1-12
  - **Do:** `extraction/plan.ts` (15-page PDF_NATIVE batches with 25 MB guard; ~12k-token TEXT batches), `extraction/batch.ts` (sub-PDF with `pdf-lib`, `runStage`, TEXT fallback, idempotent inserts by ordinal, batch status).
  - **Done when:** fake-LLM integration tests: success, PDF failure → TEXT fallback, rerun skips SUCCEEDED batches.
  - **Refs:** 06 J2, 07 §7.2.3.

- [x] **M1-14 · Quote and number verification** · P0 · M · deps: M1-13
  - **Do:** `extraction/verify-quote.ts` (07 §7.2.4); flags `QUOTE_UNVERIFIED`, `LOW_CONFIDENCE`, `SAFETY_SENSITIVE` (model flag + keyword rules 07 §7.2.7); EXTRACTED → NEEDS_REVIEW.
  - **Done when:** table-driven tests (hyphenation, soft hyphen, ё/е, quotes, fuzzy threshold, number not found).

- [x] **M1-15 · Ingestion orchestrator (`ingest-source`)** · P0 · M · deps: M1-13, M1-14, M0-14
  - **Do:** handler + Trigger.dev task (06 §6.3 J1): rights gate, sniff, parse, pages, plan, `batchTriggerAndWait` (sequential in inline mode), finalize READY/FAILED with progress JSON, audit; reprocess semantics (attempt + 1; unapproved cards of older attempts → ARCHIVED `SUPERSEDED`).
  - **Done when:** inline integration tests (happy, BLOCKED, one batch failed → READY partial, reprocess); dev run on one real PDF. *(Tests and the real-PDF dev run done 2026-10-03, see decision log.)*

- [x] **M1-16 · Card embeddings and dedupe** · P0 · S · deps: M1-11, M1-15
  - **Do:** `embed-knowledge-items` job (skip if hash unchanged; also the re-embed job for model changes); dedupe suggestions (cosine ≥ 0.92, same language) → `DUPLICATE_SUSPECTED` + `duplicate_of_id`; re-embed on edit/approve.
  - **Done when:** tests with fake embeddings (forced similar pair flagged; unchanged card not re-embedded).

- [x] **M1-17 · Knowledge Base list UI** · P0 · M · deps: M1-15, M0-16
  - **Do:** `/knowledge/cards`: filters (status, category, source, flags, language), text search, status counts, default review order (07 §7.2.8), bulk approve/archive (`bulkTransitionKnowledgeCards`).
  - **Done when:** 500-card fixture list loads in < 1 s server time; bulk approve skips unverified cards (test). *(Visual check by Ihor on the dev database, 2026-10-04: no remarks.)*

- [x] **M1-18 · Knowledge card review UI and versions** · P0 · L · deps: M1-17
  - **Do:** `/knowledge/cards/[id]`: structured editor (procedure, ingredients, temperatures, timings, mistakes), evidence viewer (cited page ± 1, highlighted quote, link to PDF page via presigned URL), flags, version history, transitions (10 §10.4.1) with role guard. Actions `updateKnowledgeCard`, `transitionKnowledgeCard`; `knowledge_item_versions` snapshot on approve; approved-card edit → NEEDS_REVIEW + variant flags hook.
  - **Done when:** the chef approves/edits/archives in the UI; version rows are correct (tests). *(Service, screen, tests and build done 2026-10-04; open: the chef's and Ihor's try-out of `/knowledge/cards/[id]` on the dev database, then tick.)*
  - **Refs:** 05 §5.4.

- [x] **M1-19 · Retrieval service** · P0 · S · deps: M1-16
  - **Do:** `knowledge/retrieval/`: `candidatePool()` (filters, recent-use exclusion, MMR λ 0.7, ≤ 60), `searchApproved(query)`, `getIdeaCards(ideaId)` (approved snapshots).
  - **Done when:** PGlite tests with fake embeddings (diversity, exclusion).
  - **Refs:** 07 §7.9.1.

- [x] **M1-20 · Manual cards and duplicate merge** · P1 · S · deps: M1-18
  - **Do:** `createManualKnowledgeCard`, `mergeDuplicateCards` + UI.
  - **Done when:** tests; merge refuses cards used by ideas.

- [x] **M1-21 · Source chunks and source search** · P1 · M · deps: M1-06, M1-07, M1-11
  - **Do:** page-aware chunker (~800 tokens, 100 overlap), chunk embeddings in `ingest-source`, "search sources" panel in the card editor.
  - **Done when:** deterministic chunk tests; search finds the fixture passage.

- [x] **M1-22 · Historical posts import** · P1 · M · deps: M1-01, M0-16
  - **Do:** CSV/JSON import (07 §7.2.5) → job J16 → `historical_posts`; `/knowledge/posts` with metrics, annotation editor, exemplar toggle; template CSV in `docs/runbooks/historical-posts.md`.
  - **Done when:** parsing tests (quotes, emojis, Russian text, bad rows reported).

- [x] **M1-23 · Post annotation suggestions** · P1 · M · deps: M1-22, M1-10
  - **Do:** `post-annotator@1` + job J17 + confirm UI.
  - **Done when:** fake-LLM tests; confirmed annotations are never overwritten.

- [x] **M1-24 · Scanned-page transcription and card English gloss** · P1 · M · deps: M1-15, M1-18
  - **Do:** `page-transcriber@1` + J19 (pages without text layer → text, then re-verify quotes); `knowledge-gloss@1` + `requestCardGloss` (UI label "not approved text").
  - **Done when:** fake tests; the gloss never appears as approved content.

- [x] **M1-25 · M1 acceptance** · P0 · S · deps: M1-18, M1-19 — _done except the real ≥ 100-page PDF, the DOCX and the 20-card spot check: see M1-25a_
  - **Do:** E2E spec 1 (13 §13.4) with fakes; manual run on one real book and one DOCX in dev; record pages, cards, % verified quotes, cost, time, top issues in `decision-log.md`.
  - **Done when:** M1 DoD (14 §14.2) checked.

- [ ] **M1-25a · M1 acceptance with real files and Sergey's check** · P0 · S · deps: M1-25, B-05
  - **Do:** upload a real PDF of ≥ 100 pages and a real DOCX on `/knowledge/sources`; run `pnpm rc source-report <id>` for each and add the numbers to `decision-log.md`; Sergey spot-checks 20 random approved or reviewed cards for accuracy (record the result). Put the E2E specs into CI once a test Supabase project exists (B-02, `docs/runbooks/e2e.md`).
  - **Done when:** the M1 DoD (14 §14.2) is fully checked with real files.

- [ ] **I18N-01 · Russian interface for the remaining screens** · P1 · M · deps: M1-17
  - **Do:** move the hard-coded English strings of the other screens into `apps/web/src/lib/i18n` (`en.ts`, `ru.ts`): settings forms (brand, visual system, taxonomy, markets), placeholders, banners, the `useAction` fallback error, field errors, dates and the market time zones; translate the taxonomy and category labels shown in the UI (they come from `taxonomy_terms`, so either a per-locale label column or a code → label table in the catalogs). Every new screen from now on adds `en` and `ru` together.
  - **Done when:** no English literal is left in `apps/web/src` JSX outside the catalogs and brand names; the catalog parity test passes; each screen checked in both languages.
  - **Refs:** M1-17 decision log entry, 10 §10.5.

## M2 · Content Engine → Gate G1

- [x] **M2-01 · Content schema (0003_content)** · P0 · M · deps: M1-01
  - **Do:** `products`, `offers`, `master_ideas`, `master_idea_knowledge`, `content_variants`, `voice_examples`; FKs on `generation_runs`; JSON types (`Slide`, `CtaSpec`, `UtmSpec`, `MarketBrief`, `CriticReport`, `DifferentiationReport`, `GenerationConfig`, `PipelineState`, `ValidationIssue`).
  - **Done when:** migration + round-trip tests; partial unique index test.
  - **Refs:** 04 §4.3 (0003).

- [x] **M2-01a · archiveSource idea-usage guard** · P1 · S · deps: M2-01, M1-03
  - **Do:** in `archiveSource` (`modules/src/knowledge/sources/service.ts`, TODO marker) refuse with `InvalidStateError` listing the ideas when an approved card of the source is linked through `master_idea_knowledge` to a non-archived idea [05 §5.3].
  - **Done when:** test with a linked idea (refused) and after the idea is archived (allowed).
  - **Refs:** 05 §5.3.

- [x] **M2-02 · Products and offers** · P0 · M · deps: M2-01, M0-17
  - **Do:** services, actions, `/knowledge/offers` UI (products; offers per market with currency check, priority, default keyword, landing URL).
  - **Done when:** tests; UI works in dev.
  - **Refs:** 05 §5.5.

- [x] **M2-03 · Template catalog metadata** · P0 · S · deps: M0-01
  - **Do:** `templates/src/define-template.ts` + `registry.ts` with metadata for A–F (08 §8.2.1), no components yet; `validateSlideAgainstTemplate()`; compact catalog text for prompts.
  - **Done when:** tests for limits and required slots.

- [x] **M2-04 · Units and numeric fidelity** · P0 · M · deps: M0-01
  - **Do:** `localization/units.ts`, `numeric-fidelity.ts` (07 §7.9.3).
  - **Done when:** table-driven tests incl. es-ES and EN formatting, tolerances, ranges.

- [x] **M2-05 · Content validators** · P0 · M · deps: M2-03, M2-04
  - **Do:** `content/validation/*` (07 §7.8) returning `ValidationIssue[]` with severity; blocking classification.
  - **Done when:** pass/fail tests per validator.

- [x] **M2-06 · Idea generator prompt v1 and context builder** · P0 · M · deps: M1-19, M1-10
  - **Do:** prompt + schema; context (card digests from `candidatePool`, ideas of the last 60 days, offers by priority, market notes, optional performance memory); post-validation (IDs ⊆ pool, near-duplicate filter vs recent ideas, product exists).
  - **Done when:** fake-LLM tests; prompt snapshot.
  - **Refs:** 07 §7.6, §7.9.1.

- [x] **M2-06a · `getIdeaCards(ideaId)`** · P0 · S · deps: M2-01, M1-19
  - **Do:** in `knowledge/retrieval`: the approved snapshots of the cards linked to an idea through `master_idea_knowledge` (PRIMARY and SUPPORTING, with the linked `knowledge_version`), using `getApprovedSnapshots`; plus the "used as PRIMARY in the last 30 days" lookup that feeds `candidatePool({ recentlyUsedIds })`.
  - **Done when:** tests with a linked idea: snapshots in link order, an edited card still returns the linked version; recent-use lookup respects the 30-day window and PRIMARY only.
  - **Refs:** 07 §7.9.1, 04 §4.3.

- [x] **M2-07 · Ideas service and job** · P0 · M · deps: M2-06, M2-01
  - **Do:** `generate-ideas` handler + task; actions `generateIdeas`, `createManualIdea`, `updateIdea`, `transitionIdea`; links with approved versions; audit.
  - **Done when:** integration tests (manual idea with a non-approved card refused; generated ideas PROPOSED with links).
  - **Refs:** 05 §5.6.

- [x] **M2-08 · Ideas UI** · P0 · M · deps: M2-07
  - **Do:** `/content/ideas` (tabs, generate dialog), `/content/ideas/[id]` (detail, linked cards, actions, "Generate ES + EN drafts"), manual idea form with approved-card picker.
  - **Done when:** flows work in dev with fakes; screenshots.

- [x] **M2-09 · Market adapter prompt v1** · P0 · M · deps: M2-03, M1-10
  - **Do:** prompt + `MarketBrief` schema + validators (5–10 slides, first HOOK, templates exist, IDs ⊆ idea, differs from sibling plan); unit conversion table injected.
  - **Done when:** fake tests; prompt snapshot; es-ES/EN rules reviewed by Ihor (and native reviewers when available).

- [x] **M2-10 · Content writer prompt v1** · P0 · M · deps: M2-05, M2-09
  - **Do:** prompt + schema (slots as `{ slot, text }[]`), slot limits and exemplar block rendering, repair via `runStage`.
  - **Done when:** fake tests incl. repair after slot overflow.

- [x] **M2-11 · Cross-market differentiation checker** · P0 · M · deps: M1-11
  - **Do:** `localization/differentiation.ts` (07 §7.10) with thresholds config + version.
  - **Done when:** tests with forced-similar fake embeddings; template-sequence distance tests.

- [x] **M2-12 · Critic prompt v1 and verdict policy** · P0 · M · deps: M2-05, M2-11
  - **Do:** prompt + schema; `content/pipeline/policy.ts` (07 §7.6.3); quality score.
  - **Done when:** policy table tests; fake critic tests.

- [x] **M2-13 · Variant generation pipeline** · P0 · L · deps: M2-10, M2-11, M2-12
  - **Do:** `content/pipeline/generate-variants.ts` (07 §7.6.2): locking, shuffled sequential adapters, parallel writers, validation + repair, critic loop (≤ 2 rewrites), persistence of fields/flags/config/`template_sequence`/`content_length`, `pipeline_state` resume, failure handling.
  - **Done when:** integration tests: happy, rewrite, flag, resume after simulated crash, failure → DRAFT + `GENERATION_FAILED`.

- [x] **M2-13a · Flag variants when a card they cite changes** · P0 · S · deps: M2-01, M1-18
  - **Do:** the hook of 05 §5.4 that M1-18 left open: when a CHEF_APPROVED card is edited (`updateKnowledgeCard`, back to NEEDS_REVIEW as version + 1) every unpublished variant that cites it gets flag `KNOWLEDGE_CHANGED` (a warning); when an approved card is archived (`transitionKnowledgeCard`) they get `KNOWLEDGE_ARCHIVED` (blocks approval). Published variants are never touched. Fill `usedByIdeas` in `getCardWithEvidence` (M2-06a lookup).
  - **Done when:** tests with a linked idea and variants in several statuses (flag set on the unpublished ones only, cleared when the card is approved again).
  - **Refs:** 05 §5.4, 10 §10.4.1, 04 §4.4 `VariantFlag`.

- [x] **M2-13b · Refresh the comparison of sibling variants after a partial run** · P1 · S · deps: M2-13, M2-11
  - **Do:** after `generateVariants` has finished some variants, recompute the differentiation report and the `DUPLICATION_RISK` flag of the live variants of the idea that were not in the run (not PUBLISHING, PUBLISHED, REJECTED or GENERATING); nothing else of them changes.
  - **Done when:** tests: a stale warning is cleared, a new one is added, a published sibling is untouched. Found in the G1 pilot (a regenerated market left the other with a stale flag).

- [x] **M2-12a · Critic: hook strength** · P1 · S · deps: M2-12
  - **Do:** `critic@2` (new version + eval): score or issue category for the hook (a real hook vs a general statement), and a writer rule; `decideVerdict` asks a rewrite for a weak hook only with a concrete instruction.
  - **Done when:** the pilot's weak hook case is flagged by the critic in an eval; no regression on the synthetic set. Found in the G1 pilot (a weak hook passed with 4.37).

- [x] **M2-12b · Hook library for carousels** · P1 · M · deps: M2-12a, M2-16
  - **Do:** `prompts/src/shared/hook-library.ts` (patterns, best angles and en/es examples per `hook_type` code, banned patterns per language; a code without an entry falls back to its label); `market-adapter@3` (hook type terms carry their patterns and angles); `content-writer@5` (patterns of the chosen hook type as guidance, the banned list as a rule); a check in code with one repair: a number in the hook line or on the HOOK slide appears in a cited card, no banned phrase. New versions only; the critic is unchanged.
  - **Done when:** eval of the current versions vs `market-adapter@3` + `content-writer@5` on the synthetic set with no regression and the judge's hook score not lower; activation recorded in `decision-log.md`; unit tests for the number and banned-phrase checks. The library is reused by M8-03.
  - **Refs:** `docs/design/hook-library.md` §1–5, 07 §7.5, 11 (lift by `hook_type`).
  - **Result (code, 2026-10-14):** `prompts/src/shared/hook-library.ts`, `market-adapter@3`, `content-writer@5` (active since p1.7.0), `validateHookLine` in `modules/src/content/validation/hook.ts` with tests. The fake `pnpm eval` passes with both versions active. Live before/after eval run the same day with no regression; activated as p1.7.0 (decision log 2026-10-14).

- [x] **M2-14 · `generate-content` job and actions** · P0 · M · deps: M2-13, M0-14
  - **Do:** J5 handler + task; actions `generateVariants`, `regenerateVariant`; `getStatuses` for variants (stage from `pipeline_state`).
  - **Done when:** inline integration test from action to READY_FOR_REVIEW.
  - **Refs:** 06 J5.

- [x] **M2-15 · Draft viewer v0** · P0 · M · deps: M2-14, M2-08
  - **Do:** `/content/review/[ideaId]` read-only: idea + cards; per market: hook, slides as text cards (template, role, cited cards), caption, CTA, hashtags, critic verdict/scores/issues, flags; differentiation panel; "Regenerate all".
  - **Done when:** usable for G1 review in dev; screenshots.

- [x] **M2-16 · Eval harness v1** · P0 · M · deps: M2-13
  - **Do:** `evals/`: case format, runner (`pnpm eval`), metrics (07 §7.12), `eval-judge@1`, cost preview + confirmation, results JSON, blind pair export (CSV/Markdown); synthetic sample set.
  - **Done when:** runs with the fake provider in CI (smoke) and with the real provider manually.

- [x] **M2-17 · Voice examples and few-shot v1** · P1 · S · deps: M2-01, M2-10
  - **Do:** `voice_examples` CRUD + seed import (Sergey's edits), exemplar selection (07 §7.11 v1) incl. rights exclusion.
  - **Done when:** selection tests; the writer receives examples.

- [ ] **M2-18 · Gate G1 run and decision** · P0 · S · deps: M2-15, M2-16, M1-25, B-08, B-09
  - **Do:** 10 ideas × 2 markets on real approved cards; metrics; native reviewers score blind pairs; Ihor/Sergey rate approvability; `docs/decisions/G1.md` with pass/fail per criterion (14 §14.3) and actions.
  - **Done when:** G1 decision recorded.

## M3 · Creative Engine

- [x] **M3-01 · Creative schema (0004_creative)** · P0 · S · deps: M2-01
  - **Do:** `visual_assets`, `carousel_renders`, `rendered_slides`, `content_variants.current_render_id`; `QaReport` type.
  - **Done when:** migration + tests.

- [x] **M3-02 · Visual director prompt v1 and pipeline step** · P0 · M · deps: M2-13, M3-01
  - **Do:** prompt + `VisualBrief` schema + validators (slot coverage, library IDs and rights); final pipeline step; persist `visual_brief_json`; action to regenerate the brief.
  - **Done when:** fake tests; pipeline test includes the visual step.
  - **Refs:** 07 §7.6.4.

- [x] **M3-03 · Image provider (OpenAI) and fake** · P0 · M · deps: M0-04 · ⚠ V-19
  - **Do:** `ImageProvider` interface, OpenAI Images adapter (current gpt-image model, portrait size, quality), fake (gradient PNG with slot label), cost per image.
  - **Done when:** MSW contract test; fake test.

- [x] **M3-04 · Image normalization and pHash** · P0 · M · deps: M0-13
  - **Do:** `visuals/images/normalize.ts` (auto-orient, sRGB, attention crop to slot aspect, resize, WebP q90, keep original), `phash.ts`, storage keys.
  - **Done when:** fixture tests (dimensions, color space, hash stability).

- [x] **M3-05 · `generate-visual-assets` job** · P0 · M · deps: M3-02, M3-03, M3-04
  - **Do:** J7: per planned slot → provider → normalize → R2 → `visual_assets`; update slide image slots; per-slot failure with retry action; `VISUAL_MISSING` flag; trigger render.
  - **Done when:** integration test with fakes; idempotent rerun creates no duplicates.
  - **Refs:** 06 J7.

- [x] **M3-06 · Fonts, theme tokens and glyph checks** · P0 · M · deps: M2-03, B-10
  - **Do:** bundle fonts (WOFF2 + TTF) in `templates/assets/fonts` (brand fonts if licensed, else OFL fallback); theme tokens from `brands.visual_system` + market variant → CSS variables; `glyphs.ts` with fontkit.
  - **Done when:** tests: Spanish/French characters covered; emoji or unsupported char reported.
  - **Refs:** 08 §8.3, §8.6.

- [x] **M3-07 · Template framework** · P0 · M · deps: M3-06
  - **Do:** `SlideDocument` (1080×1350, safe area, logo anchor, page indicator), `renderSlideHtml(slide, theme, assets)` → full HTML with inline CSS and data-URL fonts/images, `fit-text.client.js`.
  - **Done when:** HTML snapshot test for a fixture slide.
  - **Refs:** 08 §8.2, §8.6.

- [x] **M3-08 · Templates A and F** · P0 · M · deps: M3-07
  - **Do:** components + styles + fixtures (ES long, EN short, max-length, special characters).
  - **Done when:** fixtures render without overflow in the renderer (after M3-11) — until then HTML snapshots.

- [x] **M3-09 · Templates B and E** · P0 · M · deps: M3-07
  - **Do:** as M3-08 (B with and without `number`).
  - **Done when:** as M3-08.

- [x] **M3-10 · Templates C and D** · P1 · M · deps: M3-07
  - **Do:** as M3-08; D uses an icon set in `templates/assets/icons`.
  - **Done when:** as M3-08.

- [x] **M3-11 · Playwright renderer and render QA** · P0 · M · deps: M3-08
  - **Do:** `visuals/render/renderer.ts` (one Chromium per run, viewport 1080×1350, DPR 1, fonts ready, fit-text, overflow/logo/image checks, PNG → sharp JPEG q90 4:4:4 sRGB, size guard) and `qa.ts`.
  - **Done when:** renders fixtures in CI and in Claude Code (pre-installed Chromium); QA catches a forced overflow.
  - **Refs:** 08 §8.6, §8.7.

- [x] **M3-12 · `render-carousel` job and auto-trigger** · P0 · M · deps: M3-11, M3-05 · ⚠ V-17
  - **Do:** J8 with the Playwright build extension, `medium-1x` machine, `render` queue; input-hash idempotency; `rendered_slides`; `current_render_id`; flags; debounce on text edits.
  - **Done when:** inline integration test; dev run in Trigger.dev renders a real variant.
  - **Refs:** 06 J8.

- [x] **M3-13 · Preview: slide route and carousel viewer** · P0 · M · deps: M3-12, M2-15
  - **Do:** `/api/preview/slide` (same HTML as the renderer, draft values allowed, sandboxed iframe); carousel viewer (4:5 frame, swipe, thumbnails, 1:1 zoom, QA badges, stale-render state) in the review screen.
  - **Done when:** live preview matches the JPEG for fixtures; screenshots.
  - **Refs:** 08 §8.5.

- [x] **M3-14 · Visual regression tests** · P0 · S · deps: M3-09, M3-11
  - **Do:** golden PNGs per template × fixtures; pixelmatch compare; `pnpm test:visual --update`; CI job on `templates/**` changes + nightly.
  - **Done when:** CI job green; a deliberate CSS change fails it.
  - **Refs:** 08 §8.9.

- [x] **M3-15 · Image model bake-off** · P0 · S · deps: M3-05
  - **Do:** 10 real visual briefs × 2 models (OpenAI + one alternative through a throwaway script); blind review by Ihor/Sergey on a "premium macro food" rubric; `docs/decisions/image-provider.md`; set the default model (add a second adapter task if the alternative wins).
  - **Done when:** decision recorded.

- [x] **M3-16 · Photo library** · P1 · M · deps: M3-04, M1-04
  - **Do:** PHOTO sources → `visual_assets` (LIBRARY_PHOTO) with tags/description (manual + optional AI tags); rights check; library candidates for the visual director.
  - **Done when:** director can pick a library photo in a test.

- [x] **M3-17 · Visual QA with vision** · P1 · M · deps: M3-12
  - **Do:** `visual-qa@1` on rendered JPEGs (legibility, AI artifacts, text inside images, brand consistency) → issues added to the critic report; contrast check.
  - **Done when:** fake tests; real run on 5 variants logged.

## M4 · Review + Calendar

- [x] **M4-01 · Review and scheduling schema (0005)** · P0 · M · deps: M3-01
  - **Do:** `review_events`, `content_variant_versions`, `social_accounts`, `publications`; `content_variants.approved_version_id`; `voice_examples` FK; `ApprovedSnapshot`, `InstagramError` types.
  - **Done when:** migration + tests (partial unique indexes).
  - **Refs:** 04 §4.3 (0005).

- [x] **M4-02 · Variant state machine** · P0 · M · deps: M4-01
  - **Do:** `content/variants/state.ts`: transition table (10 §10.4.3), guards, side-effect hooks, "allowed actions" for the UI.
  - **Done when:** full transition matrix tests.

- [x] **M4-03 · Field paths and edit service** · P0 · M · deps: M4-02, M3-12
  - **Do:** `FieldPath` parse/get/set, per-field validation (template limits, caption, hashtags), optimistic locking, `review_events` (original vs edited), approval invalidation (cancel open publication, audit), debounced re-render; action `editVariantField`.
  - **Done when:** tests: edit, CONFLICT on stale lock, invalidation cancels a scheduled publication.
  - **Refs:** 04 §4.4 FieldPath, 05 §5.7.

- [x] **M4-04 · Field regeneration** · P0 · M · deps: M4-03
  - **Do:** `field-regenerator@1` + J6 + action `regenerateVariantField`; review event REGENERATE; validators; re-render.
  - **Done when:** fake tests for hook, slide, caption, CTA, image slot.

- [x] **M4-05 · Review screen v1** · P0 · L · deps: M4-03, M4-04, M3-13
  - **Do:** full UX (10 §10.3): inline edit + regenerate per field with instruction and reason code, keep/undo, slide drawer with live preview, critic panel with jump-to-field, knowledge references, conflict handling, allowed-actions driven buttons.
  - **Done when:** manual walkthrough in dev; screenshots; component tests for key interactions.

- [x] **M4-06 · Approve, reject, request changes, unapprove** · P0 · M · deps: M4-02, M4-05
  - **Do:** actions with guards (current READY render, blocking flags, checklists, offer for commercial intent); `content_variant_versions` snapshot with content hash and render; dialogs; audit.
  - **Done when:** tests for every guard; snapshot equals render hash.

- [x] **M4-07 · Drafts list and dashboard counters** · P0 · S · deps: M4-02
  - **Do:** `/content/drafts` table and filters; nav badges; dashboard counters (10 §10.2).
  - **Done when:** counts match fixture data.

- [x] **M4-08 · Scheduling service** · P0 · M · deps: M4-06
  - **Do:** `publishing/schedule.ts`: `schedulePublication`, `reschedulePublication`, `cancelPublication` (05 §5.8), idempotency key, min-gap warning, market-time-zone handling, audit.
  - **Done when:** tests (past time refused, second live publication refused, cancel restores APPROVED).

- [x] **M4-09 · Calendar UI** · P0 · M · deps: M4-08
  - **Do:** `/content/calendar` week grid (market colors/flags), list view, "approved, not scheduled" sidebar, schedule dialog (market time zone), status and warnings.
  - **Done when:** schedule/reschedule/cancel work in dev; screenshots.

- [x] **M4-10 · Review → schedule E2E** · P0 · S · deps: M4-09
  - **Do:** E2E spec 3 (13 §13.4).
  - **Done when:** green in CI.

- [x] **M4-11 · Campaign IDs, UTM links and ManyChat checklist** · P0 · S · deps: M4-06, M2-02
  - **Do:** `offers/campaigns.ts` (`rc-{market}-{yymmdd}-{6}` at approval of commercial variants), `offers/utm.ts`, review-screen panel with copyable keyword, DM link and flow name; checklist item "ManyChat flow set up" for keyword CTAs.
  - **Done when:** tests (format, uniqueness, UTM encoding); panel visible.
  - **Refs:** 11 §11.7.

## M5 · Instagram → Gate G2

- [x] **M5-00 · Meta verification pass** · P0 · S · deps: B-11, B-14
  - **Do:** check V-01 … V-16 against the official docs ([S§24] links); record findings and plan changes in `decision-log.md`; update 09 if needed. Needs network access to `developers.facebook.com` (B-14) or run locally.
  - **Done when:** every ⚠ Meta item has a verified value or a documented decision.

- [x] **M5-01 · Instagram module foundation (+ 0006)** · P0 · M · deps: M4-01, M0-07, M5-00
  - **Do:** migration 0006 (`publish_attempts`, `integration_events`); `instagram/http.ts` (timeouts, JSON, error normalization, path-only logging, token transport), `errors.ts` (09 §9.4.4), config (`META_GRAPH_API_VERSION`, `INSTAGRAM_GRAPH_BASE_URL` — points to the mock Graph API in E2E), MSW fixtures for every call and error class (also served over HTTP as the E2E mock).
  - **Done when:** classification tests; wrapper never logs tokens (test).

- [x] **M5-02 · OAuth connect flow** · P0 · M · deps: M5-01, M0-15
  - **Do:** `/api/instagram/oauth/start` and `/callback` (09 §9.2): state cookie + HMAC, code → short → long-lived token, `/me`, professional check, market binding check, encryption (AAD = row id), audit.
  - **Done when:** MSW tests: happy, tampered state, expired state, non-professional account, account bound to another market.

- [x] **M5-03 · Settings → Instagram UI and banners** · P0 · S · deps: M5-02
  - **Do:** `/settings/instagram` per market (connect/reconnect/disconnect, token status and expiry, quota, last publish, last error); app-shell banners (NEEDS_REAUTH, expiring < 7 days).
  - **Done when:** states render from fixtures; screenshots.

- [x] **M5-04 · Token refresh and account health jobs** · P0 · M · deps: M5-02, M0-14
  - **Do:** J13 and J14 (06 §6.3), `integration_events`, status transitions (VALID/EXPIRING/INVALID).
  - **Done when:** MSW tests (refresh ok, 190 → NEEDS_REAUTH, not refreshed if < 24 h old).

- [x] **M5-05 · Meta callbacks** · P0 · S · deps: M5-02 · ⚠ V-13
  - **Do:** `/api/meta/deauthorize` and `/api/meta/data-deletion` with `signed_request` verification; status page for deletion codes.
  - **Done when:** tests with signed fixtures (valid, invalid signature).

- [x] **M5-06 · Publish state machine** · P0 · L · deps: M5-01, M4-08
  - **Do:** `publishing/publish-machine.ts` (09 §9.4): steps, persisted progress, safeguards, presigned URLs for renders, reconciliation, dry run, `publish_attempts` per call.
  - **Done when:** MSW tests for every path in 13 §13.3 (incl. crash after `media_publish` → no second publish, wrong-market account refused).

- [x] **M5-07 · Dispatcher and publish task** · P0 · M · deps: M5-06
  - **Do:** J9 cron (SKIP LOCKED claim, kill switch, stuck recovery) and J10 (queue per account, retries, `AbortTaskRunError` on permanent errors, global idempotency key); `retryPublication`; concurrency test on real Postgres (CI service container).
  - **Done when:** tests: one claim per publication under parallel dispatchers; retry creates a new key.

- [x] **M5-08 · Environment guards and kill switch** · P0 · S · deps: M5-07
  - **Do:** `INSTAGRAM_PUBLISH_MODE`, `INSTAGRAM_ACCOUNT_ALLOWLIST`, `setPublishingEnabled` (owner, audited), header indicator.
  - **Done when:** tests: `off` blocks, `dry_run_only` blocks live, unknown account refused.

- [x] **M5-09 · Publish UX** · P0 · M · deps: M5-07, M4-09
  - **Do:** "Publish now", "Schedule", "Dry run" in review and calendar; publication drawer (attempt timeline, readable errors with next steps, permalink); retry/cancel.
  - **Done when:** flows work against MSW-backed dev; screenshots.

- [x] **M5-10 · Smoke script and runbook** · P0 · S · deps: M5-07
  - **Do:** `scripts/ig-smoke.ts` (`pnpm ig:smoke --account <id> [--live]`) and `docs/runbooks/instagram-smoke.md` (13 §13.6).
  - **Done when:** dry-run smoke passes on a test account (manual, logged).
  - **Status 2026-10-12:** the script, the service behind it (tested on the mock Graph API) and both runbooks are done, and the manual dry run passed on the test account `@chef.skk` (decision log, 2026-10-12). It was run through the product's own **Dry run** button on an approved English draft, not through `pnpm ig:smoke`; the script itself has not been run against Meta yet (do that once, `--dry-run`, before G2 so its report is in the log).

- [ ] **M5-11 · Gate G2 and first live posts** · P0 · S · deps: M5-08, M5-09, M5-10, B-12, B-13
  - **Do:** run G2 checklist (14 §14.3): live smoke on test account, idempotency drill, dry runs on production accounts, kill switch, token refresh; first 3 posts per market with Sergey's approval; `docs/decisions/G2.md`.
  - **Done when:** G2 recorded; first production posts have media ids and permalinks.
  - **Status 2026-10-11:** prepared (`docs/decisions/G2.md` with the order of work and empty record tables; `pnpm rc g2-check` for the items the database can show). The run itself waits for B-11, B-12, B-13 and Sergey's approval. Tick this box when G2 is recorded.

- [x] **M5-12 · AI imagery disclosure option** · P0 if B-13 requires it, else P1 · S · deps: M3-05, B-13 · ⚠ V-16
  - **Do:** per-market setting `ai_imagery_disclosure` = `NONE | CAPTION_NOTE | SLIDE_BADGE` (and platform label if the API supports it); applied when a variant uses generated photo-realistic images.
  - **Done when:** tests; the reviewer sees what will be added.

## M6 · Analytics

- [x] **M6-01 · Analytics schema (0007) and views** · P0 · M · deps: M5-01
  - **Do:** `metric_snapshots`, `account_metric_snapshots`, `attribution_events`; views `v_publication_dimensions`, `v_publication_metrics_d7`, `v_campaign_attribution` (11 §11.3).
  - **Done when:** view tests on fixture data (D7 choice, fallback to D3, dayparts in market time zone).
  - **Result (2026-10-15):** `db/src/schema/analytics.ts`, migration `0011_analytics.sql` (the three tables, the enums `snapshot_slot` and `attribution_event_type`, the three views written by hand), `db/src/json/analytics.ts`. 18 view and table tests on fixture data: the D7 choice (D7 beats D28, the D3 fallback flagged by `is_exact_d7`, the age and not the slot name decides, nothing under 72 h), null rates without reach, the engagement rate from total interactions or its parts, dayparts and weekday in the market's zone (Madrid and New York, every cut at 6, 11, 15 and 18), dry runs left out, campaign sums with refunds and quantities, event dedupe by source and reference. Differences from plan 11 §11.3 are in plan 04 (no experiment columns yet, `quantity` counts).

- [x] **M6-02 · Insights client** · P0 · M · deps: M5-01 · ⚠ V-10, V-11
  - **Do:** media and account insights calls; metric list per media type; unsupported-metric handling with cached availability; mapping to columns; raw storage.
  - **Done when:** MSW tests (full response, unsupported metric, missing values stay null).
  - **Result (2026-10-15):** `modules/src/instagram/insights.ts` (V-10 and V-11 read from Meta's docs, live check open): metric lists per media type (FEED for a carousel, REELS), `getMediaInsights` (plain call plus `profile_activity` with its breakdown; an unsupported metric is dropped by name and the call repeated, or each metric asked alone), the mapping to the snapshot columns (`saved` → `saves`, `follows` → `follower_change`, profile actions, Reels watch metrics), the cached availability in `app_settings.instagram.metric_availability`, `getAccountInsights` (reach by `follow_type`, views, accounts engaged, interactions, follows and unfollows, followers count; each call stands alone). The mock Graph API answers insights (a media that refuses metrics, holes in the answer, account metrics refused under 100 followers). Error 80002 is now a rate limit. 13 tests: full answer, unsupported metric (named and not named), missing values stay null, deprecated metrics never sent, token and rate-limit errors thrown.

- [x] **M6-03 · Snapshot jobs** · P0 · M · deps: M6-01, M6-02
  - **Do:** `analytics/slots.ts` (due-slot computation), J11 and J12, `collectMetricsNow` action, `integration_events` on errors.
  - **Done when:** tests: one snapshot per slot, late slot stored with real age, one failing post does not block others.
  - **Result (2026-10-15):** `modules/src/analytics/slots.ts` (due-slot rules: a slot is collected when its time has come and no snapshot is already as old as the slot; of those the latest is measured, so a post first looked at on day ten gets one snapshot named D7 with its true age, flagged late), `collect.ts` (`collectInsights` = J11, `collectAccountInsights` = J12, `requestMetricsNow`), jobs `collect-insights` (hourly at :07) and `collect-account-insights` (daily 02:17), the action `collectMetricsNow` (owner and editor; there is no screen for it until M6-09). One failing post is a finding on its account (`INSIGHTS_FAILED`) and does not stop the others; a refused token makes the account NEEDS_REAUTH and ends its posts; a rate limit stops the run and is rethrown; a finding is closed only by a run in which none of the account's posts failed. 26 tests in `analytics`: one snapshot per slot and never twice, a late slot with its real age, nulls, Reel and carousel columns, dry runs and posts without a media id left out, the per-run limit with the oldest due first, the remembered unsupported metric, manual snapshots, the market-local day for account metrics (also a 25-hour day), overwrite of the day on a second run.

- [x] **M6-04 · Metric definitions and query layer** · P0 · M · deps: M6-01
  - **Do:** `analytics/queries/`: rates, D7 standardization, dimension grouping (whitelisted dimensions), min sample, lift, Operations metrics from `review_events`/`audit_events`/`generation_runs`.
  - **Done when:** PGlite tests on a fixture dataset with known answers.
  - **Result (2026-10-15):** `modules/src/analytics/queries/` (`range`, `growth`, `engagement`, `learning`, `operations`, `published`, `lineage`) on three typed read views added to migration 0011's schema file (`v_publication_dimensions`, `v_publication_metrics_d7` with `is_exact_d7`, `v_campaign_attribution`, declared with `pgView().existing()`). Rates are medians of per-post rates over posts with a reach; a missing metric is null, never 0. Learning groups only by the whitelist `LEARNING_DIMENSIONS` (the SQL of each is fixed in code, the input is a literal union), has a minimum sample (setting `analytics.min_sample`, default 3) and a low-sample flag and lift against the market median. 30 tests (queries and published) on fixture data with known answers.

- [x] **M6-05 · Dashboard: Growth and Engagement** · P0 · M · deps: M6-04
  - **Do:** load the `dataviz` skill; tiles, followers/reach series, non-follower share, per-post rates table; market and date filters.
  - **Done when:** renders fixture data; screenshots.
  - **Result (2026-10-15):** `/analytics` (tabs Growth, Engagement, Content learning, Operations; market and range filters in one row), chart parts in `apps/web/src/components/analytics/` (`LineChart` 2 px with a 10 % wash, a table view, a tooltip that only enhances; `BarList`; `StatTile`), series colours validated with the dataviz script and added as `--viz-series-1/2` tokens (light and dark). `/dev/analytics` shows every tab and the lineage on fixtures (dev only). 25 component tests; looked at in the browser at desktop width.

- [x] **M6-06 · Dashboard: Content learning** · P0 · M · deps: M6-04
  - **Do:** dimension selector, grouped table (n, medians, lift, low-sample badge), top/bottom posts with thumbnails linking to lineage.
  - **Done when:** fixture results match the query tests.
  - **Result (2026-10-15):** the Content learning tab: dimension selector (the whitelist), grouped table with n, median save and share rate, median reach, lift and a low-sample badge, best and worst posts with thumbnails that link to the lineage. Fixture results are asserted against the query tests' numbers.

- [x] **M6-07 · Dashboard: Operations** · P0 · S · deps: M6-04
  - **Do:** generated, approval rate, rejection reasons, edits per approved variant, time to approve, critic first-pass rate, regenerations, AI cost per approved post.
  - **Done when:** fixture results correct.
  - **Result (2026-10-15):** the Operations tab: generated, approval rate, rejection reasons, edits per approved variant, time to approve, critic first-pass rate, regenerations, AI cost per approved post; a number with no basis shows a dash.

- [x] **M6-08 · Attribution events and Commercial dashboard** · P1 · M · deps: M4-11, M6-04
  - **Do:** manual entry + CSV import (J18), reconciliation list for unknown campaign ids, Commercial tab (leads, sales, revenue, revenue per 1,000 reach).
  - **Done when:** import tests (dedupe by `external_ref`); fixture dashboard.
  - **Result (2026-10-15):** `modules/src/analytics/attribution/` (`parseAttributionCsv`: known column names in any case, a mapping for others, `,` `;` or tab, sums like `1.234,50`, only the listed columns are read so names and e-mails in an export are never looked at, an order id that looks like an e-mail or a phone is stored as a hash, a row without an id gets a hash of its row number and content; `recordAttributionEvent`, `createAttributionImport` + J18 `import-attribution-csv` (insert-or-skip on `(source, external_ref)`, report in the audit log, `listAttributionImports`), `listUnknownCampaigns` and `reassignCampaign`, `deleteAttributionEvent` for owners), `queries/commercial.ts` (`getCommercial`: per campaign, offer and market; revenue per currency; revenue per 1,000 reach over the campaigns that have D7 reach). The CSV splitter moved to `@rc/lib/csv`. The **Commercial tab** on `/analytics` (tiles, campaigns with their post, sales by offer, the reconciliation list with a form, the latest events and imports, "Add an event" and "Import a CSV" dialogs; en and ru) and on `/dev/analytics`. 14 module tests (parser, import twice adds nothing, reconciliation, the dashboard numbers), 6 component tests.

- [x] **M6-09 · Published list and lineage view** · P0 · M · deps: M6-03
  - **Do:** `/content/published` (D7 rates, permalink, CSV export) and `/content/published/[id]` lineage (04 §4.6) with metrics timeline and review history.
  - **Done when:** lineage shows source → cards → idea → brief → version → publication → metrics for a fixture post.
  - **Result (2026-10-15):** `/content/published` (market, format and range filters, D7 rates and a flag when D7 fell back to D3, permalink, `export` route with CSV: UTF-8, rates as fractions, at most 5000 rows, a cell that starts with `=`, `+`, `-`, `@`, tab or return gets an apostrophe so the hook text cannot run as a formula) and `/content/published/[publicationId]` (`LineageView`: numbers at D7 and the snapshot timeline, then source cards with page and quote, idea, market brief, approved version with caption, CTA, slides or video, review history, generation cost, the Reel card of a carousel and the link from a Reel to its carousel; a "Collect numbers now" button for owner and editor). Resolves the M8-07 open item that the Reel card had no home on the published screen. 10 component tests.

- [x] **M6-10 · Progress for long actions** · P0 · M · deps: M5-07
  - **Why:** found on the first live run (2026-10-12). "Regenerate all" takes 4-6 minutes (four model stages for each market, then the pictures, then the render). After the click the page shows nothing and does not refresh itself, and the only way to tell whether work is going on is the Trigger.dev dashboard.
  - **Do:** a progress panel where the action was started: the review screen (Generate drafts, Regenerate all, field regeneration, picture generation, Render), the publication panel and drawer (the steps of the publish machine), later idea generation and source ingestion.
    - **Steps, not an invented percentage.** The step list is read from the database: `content_variants.status = GENERATING`, the `generation_runs.stage` rows so far (`MARKET_ADAPTATION`, `CONTENT_WRITING`, `CRITIC`, `VISUAL_DIRECTION`), `visual_assets`, `carousel_renders.status`, `publications.step`. A tick for a finished step, a spinner for the current one, muted for the ones to come, red for a failed one with the plain error and a link to the run. With the elapsed time and a usual duration ("usually 3-5 min", the median of earlier runs).
    - **Survives a reload and a second tab:** the state comes from the database, not from the browser.
    - **Updates itself:** one cheap read polled while a run is active and the tab is visible (every 3-5 s, slowing down), stopped at done or failed, then the page data is refreshed. One query per poll: the session pooler has only 15 client slots (decision log 2026-10-12).
    - A small indicator in the sidebar while anything runs (like the publishing indicator), and the buttons that start a run are disabled, with the reason, while one is running (no second run by a double click).
    - A run that makes no progress for a set time shows "taking longer than usual" with the link to the run instead of spinning forever.
  - **Done when:** component tests for every state (running, done, failed, stalled); a test that polling stops at done and while the tab is hidden; a manual check on a real regeneration (the stages appear in order, the page updates itself at the end).
  - **Result (2026-10-15):** `modules/src/content/pipeline/progress.ts`: `getDraftProgress` (one query per idea: the six steps ADAPT, WRITE, CRITIC, VISUAL, PICTURES, RENDER of each carousel draft, read from `pipeline_state.completedStages`, `visual_assets` (a count, "2 of 5") and the newest `carousel_renders` row; a failed run takes the failing stage from the stored error), `getActivity` (header count; a run that began more than 2 h ago is a leftover and is not counted), `usualDraftDurationMs` (median of the last 20 finished runs, from `durationMs` that `variant.generated` now records; nothing until three). `pipeline_state.updatedAt` (new, optional) is when a stage last finished; a draft, a queue or a render with no movement for 10 minutes is "stalled". Screen: `ProgressPanel` in every market's column (ticks, spinner, muted, red; elapsed and usual time; "taking longer than usual" and failed link to Health), `ReviewProgressProvider` polls `getProgress` (3 s for a minute, 5 s up to five, then 10 s; not while the tab is hidden; looks at once when it is shown again; stops when nothing runs and then refreshes the page once; never starts a refresh while the last is on its way), `ActivityIndicator` in the header next to the publishing indicator, "Regenerate all" says why it is off. `/dev/progress` shows every state on synthetic data. 16 service tests, 22 component tests (every state, stop at done, hidden tab, slowing down).
  - **Not done:** the publication panel already shows its step; idea generation and source ingestion keep their own progress (sources: plan 10 §10.5); the Reel card keeps its own three-stage progress (M8-07) and is not on the new panel yet. A rewrite of the text is not seen as such until the critic reports (the panel shows the next step for a moment). The manual check on a real regeneration is open (no migration is needed): the stages should appear in order and the page should update itself at the end.

## M7 · Learning (P1)

- [x] **M7-01 · Learning schema (0008)** · P1 · S · deps: M6-01
  - **Do:** `performance_summaries`, `experiments`, variant experiment columns, `master_ideas.performance_summary_id`.
  - **Done when:** migration + tests.
  - **Result (2026-10-15):** migration `0012_learning.sql` (reviewed by hand; the custom part adds the `experiments` updated_at trigger and replaces `v_publication_dimensions` with the experiment columns), `db/src/schema/learning.ts`, `db/src/json/learning.ts` (`PerformanceMemory` as a Zod schema, `PerformanceStats`, `EXPERIMENT_DIMENSIONS`). 3 schema tests (a summary per market and across markets linked from an idea; the experiment checks and trigger; an arm needs its experiment and shows in the view). **The owner applies 0012 with `pnpm db:migrate` before this code is deployed.**

- [x] **M7-02 · Performance summary builder** · P1 · M · deps: M6-04, M7-01
  - **Do:** `analytics/summaries/` algorithm (11 §11.5), JSON ≤ ~1,500 tokens, caveats.
  - **Done when:** fixture tests (patterns, overuse, gaps, empty-pattern case below data threshold).
  - **Result (2026-10-15):** `modules/src/analytics/summaries/build.ts` (`buildPerformanceSummary`: posts of the window with D7 numbers, nine dimensions, each post's rate divided by its market's median so the summary across markets (`ALL`, `market_id` null) is fair to a small market; patterns from `min_sample` posts with lift ≥ 1.2 or ≤ 0.8, five each, confidence by n; pattern lists empty with a caveat below `learning.min_posts_for_patterns` (default 20); overused themes and coverage gaps from `content/ideas/overuse.ts` (shared with M7-05); untested visual hypotheses, DRAFT experiments and unused hook types; active offers by priority with leads and sales; top rejection reasons, most-edited field kinds, the last hook rewrites; `fitSummary` keeps the JSON under 6,000 characters; stored with the raw groups in `stats_json`). 6 tests on fixture history (lift with known answers, the empty-pattern case, the cross-market normalization, gaps, untested, offers, feedback, the size limit).

- [x] **M7-03 · Summary job and view** · P1 · S · deps: M7-02
  - **Do:** J15 (weekly + manual + stale-before-ideas), Analytics → Learning summary view.
  - **Done when:** job test; view renders.
  - **Result (2026-10-15):** J15 `build-performance-summary` (cron Monday 04:11 UTC, also triggerable with a payload): `buildPerformanceSummaries` builds one summary per active market and one across them; `ensureFreshSummaries` runs in the J4 handler before ideas when the summary across markets is missing or more than 7 days old (a failure there is logged and the ideas are still made); `requestPerformanceSummary` + action `buildPerformanceSummary` ("Build now", owners and editors, each click its own run). The **Learning summary** tab on `/analytics` (the market's summary, or the one across markets under "All markets": patterns with lift, metric and confidence, overuse, gaps, untested ideas, offers, reviewer feedback, caveats; en and ru) and on `/dev/analytics`. 3 job tests, 4 component tests, the task registration test.

- [x] **M7-04 · Learning into generation (v2 prompts)** · P1 · M · deps: M7-03, M2-16
  - **Do:** `idea-generator@2` (performance memory rules), `content-writer@2` (hook guidance, rejection digest, exemplars by D7); set `performance_summary_id`; eval v1 vs v2; bump `PIPELINE_VERSION` only if no regression.
  - **Done when:** eval results logged; activation decision in `decision-log.md`.
  - **Result (2026-10-15):** the version numbers moved on since the plan was written: the learning-aware prompts are **`idea-generator@3`** (v2 plus the rules for `<performance_memory>`: prefer strong patterns, avoid overused themes, fill a gap, give an untested idea a chance, respect offers, name the reason in `whyNow`) and **`content-writer@6`** (v5 plus `<learning>`: hook-type guidance from the market's D7 numbers as advice, an avoid list from rejection reasons). `modules/src/content/learning/` reads the newest summary (at most 30 days old) and decides by the active prompt version: idea-generator ≥ 3 gets the summary across markets and the idea stores `performance_summary_id`; content-writer ≥ 6 gets its market's learning and the market's two best posts by D7 save rate as examples. `pnpm eval --stage-version STAGE=N` runs a stage with another version. Fake eval green with the active versions and with `CONTENT_WRITING=6 IDEA_GENERATION=3`. 9 prompt tests, 7 module tests.
  - **Activation: not yet** (decision log 2026-10-15). `STAGE_CONFIG` stays at idea-generator@2 and content-writer@5 and `PIPELINE_VERSION` at 1.7.0: the shared database has no D7 numbers yet, so a v5/v6 comparison would compare the same input. Activate after about 20 posts per market have D7 numbers: a live eval of both (about $2.5, the owner's yes), then the two `STAGE_CONFIG` entries and `PIPELINE_VERSION` 1.8.0 in one commit.

- [x] **M7-05 · Overuse filter and idea diversity** · P1 · S · deps: M7-02
  - **Do:** deterministic pre-filter in the candidate pool (penalize overused categories/angles); MMR over proposed core messages.
  - **Done when:** tests on fixture history.
  - **Result (2026-10-15):** `content/ideas/overuse.ts` (`findOverusedThemes`: a category, or a narrower category + angle pair, approved at least 3 times in 21 days or more than 30 % of the approvals, counted per variant in a market and per idea across markets; `findCoverageGaps`: categories with at least 5 approved cards and no post in 30 days; `categoryWeightsFrom`: 0.5 for an overused category, 1.3 for a gap) feeds `candidatePool`'s weights in every idea run (active now: deterministic, no prompt change). `content/ideas/diversity.ts`: the model is asked for a third more ideas (at most 10) and MMR over the embeddings of the core messages keeps the asked number (λ 0.7, relevance 0.6 for an idea in an overused theme), in the model's order; the rest is `notPicked` in the result. 8 tests on fixture history and the pick, 1 on the idea stage.

- [x] **M7-06 · Experiments-lite** · P1 · M · deps: M7-01, M6-04
  - **Do:** `/experiments` CRUD, arm assignment on the review screen, results (n, medians, Mann–Whitney U when both arms reach the minimum), completion updates visual hypothesis status.
  - **Done when:** tests for "insufficient data" and result math.
  - **Result (2026-10-15):** `modules/src/analytics/experiments/` (`upsertExperiment` (a draft only), `setExperimentStatus` (DRAFT → RUNNING → COMPLETED, or CANCELLED), `assignExperimentArm` (a draft of the experiment's market into A or B, or out), `getExperimentResults` (assigned and measured per arm, medians of the primary metric at D7; the difference and a two-sided Mann–Whitney U p-value only when both arms reach the minimum, else "insufficient data"; exact for up to 20 per arm without ties, normal approximation with tie and continuity correction otherwise), `getArmChoices` for the review screen; starting an experiment linked to a market visual hypothesis makes it TESTING, completing it with CONFIRMED or REJECTED sets that status, a cancel or an inconclusive end makes it UNTESTED again). `/experiments` (list with arms, results and status buttons, create and edit dialog; en and ru), the **Experiment** section in each market's column on the review screen (`ExperimentArmPicker`). 10 service and statistics tests (known U and p values worked out by hand), 7 component tests.

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

- [x] **H-05 · AI cost view and budget alert** · P1 · S · deps: M1-10
  - **Do:** `/settings/ai` (stage config read-only, cost month-to-date by stage), `ai.monthly_budget_usd` with amber/red health states and an email alert.
  - **Done when:** fixture costs aggregate correctly.
  - **Result (2026-10-15):** `modules/src/ai/budget.ts` (`getAiCostOverview`: the UTC month's cost by stage from `generation_runs`, model and video calls alike, runs and failures, the last 24 hours, the active `STAGE_CONFIG`; `budgetState`: none, green, amber from 80 %, red above 100 %; `checkAiBudget` = J24 `check-ai-budget`, daily 06:05 UTC: one alert per month and level, remembered in `app_settings.ai.budget_alert_state`, audited). The **e-mail** goes through Sentry: the J24 task reports the alert as a Sentry message with its own fingerprint per month and level, so the "new issue" rule e-mails once (there is no mail provider in the app; `docs/runbooks/sentry.md`). Settings `ai.monthly_budget_usd` and `learning.min_posts_for_patterns` are now editable keys. `/settings/ai` is a real page: budget with its state in words and a bar, the form for owners, cost by stage, the stage table, and the Reels switch. 3 module tests (fixture costs, the thresholds, alerts once per level and month), 2 Sentry tests, 3 component tests. The health page and dashboard tile for AI cost come with H-01 (the state is `getAiCostOverview().state`).

- [x] **H-06 · Uptime monitor, secret scanning, dependency audit** · P1 · S · deps: M0-02
  - **Do:** uptime check on `/api/health`; `gitleaks` and `pnpm audit` in CI (audit as warning).
  - **Done when:** CI shows the new checks.
  - **Result (2026-10-15):** CI (`.github/workflows/ci.yml`) has two new jobs: **Secret scan (gitleaks)** (`gitleaks/gitleaks-action@v2` over the commits of the push or pull request, default rules plus `.gitleaks.toml`, whose allowlist covers tests, fixtures, snapshots, `.env.example` and the lockfile; a finding fails the build) and **Dependency audit (warning only)** (`pnpm audit --prod --audit-level=high`, then critical across all dependencies; findings are a warning annotation, never a failure). **Uptime**: `.github/workflows/uptime.yml` runs `scripts/uptime-check.sh` every 15 minutes against the repository variable `HEALTH_URL` (200 with `status: ok` passes, `degraded` passes with a warning, anything else after three tries fails, and GitHub e-mails the failure); without the variable it passes with a notice. The script was checked against a local server (ok, degraded, down, unset).
  - **Open:** the owner sets the repository variable `HEALTH_URL` to the production `/api/health`. The first audit (2026-10-15) found 13 advisories in production dependencies, 6 high: `next` < 16.3.8 (image-optimization SSRF, cache poisoning), `sharp` < 0.35.5, `ws` < 8.21.0, `@modelcontextprotocol/sdk` < 1.31.0, `source-map-js` < 1.2.2, `braces` (no fix): follow-up **H-06a** (upgrade and re-run the checks).
- [x] **H-06a · Dependency upgrades from the first audit** · P1 · S · deps: H-06
  - **Do:** upgrade `next` to 16.3.8 or later (and `@sentry/nextjs` with it), `sharp`, `ws`, `@modelcontextprotocol/sdk`, `source-map-js` (overrides where a direct upgrade is not possible); `braces` has no fix: check that no reachable path takes user input.
  - **Done when:** `pnpm audit --prod --audit-level=high` is clean or every remaining item has a reason in the decision log; `pnpm check`, build and E2E green.
  - **Result (2026-10-15):** `next` 16.3.8 (`@sentry/nextjs` 11.0.0 already accepts it); `shadcn` moved to `devDependencies` of `@rc/web` (only its CSS is imported, at build time); pnpm `overrides` in `pnpm-workspace.yaml` lift `ws` (8.22.0), `sharp` (0.35.5), `source-map-js` (1.2.2) and `@modelcontextprotocol/sdk` (1.32.1). `pnpm audit --prod --audit-level=high` is clean (1 moderate left, `sprintf-js` via `mammoth`, no fix). `braces` is now dev only (shadcn and trigger.dev CLIs, no user input): reason in the decision log. `pnpm check` and `pnpm --filter @rc/web build` green; E2E not run here (it uses the `.env` database, where the P1 migrations are not applied yet).
  - **Open:** the full audit (dev dependencies) still has `tar` (critical) and `deepmerge-ts` under the `trigger.dev` CLI (`c12` > `giget`) and `@trigger.dev/build`; the latest trigger.dev (4.7.4) keeps the same `c12`, so these need overrides of their own (a separate task).

## M8 · Reels (video-first, generated on request)

Plan and decisions: `docs/plan/18-reels.md`. Owner decisions 2026-10-13: video-first (no slideshow), on demand per post and market, estimate without a hard cap, first release includes publishing, Higgsfield (`alibaba/wan-3.0` default), placeholder audio for now, the Spanish Reel reuses the English shots.

- [ ] **M8-01 · Spec and plan** · P0 · S · deps: —
  - **Do:** `docs/plan/18-reels.md`, `docs/design/reel-style.md`, decision-log entry, this section, README row, V-24…V-29 / R-21…R-26 / Q-08…Q-10 in 16.
  - **Done when:** merged; no code.
  - **Refs:** 18.
- [x] **M8-02 · Video provider (Higgsfield)** · P0 · M · deps: M8-01 · ⚠ V-24
  - **Do:** `lib/src/providers/video/{types,factory,fake,higgsfield}.ts`; submit, poll, download into R2; idempotency key; error mapping (`nsfw`, `failed`, timeouts); cost table; `HIGGSFIELD_API_KEY` in `loadServerEnv`; MSW tests; fake returns a small fixed mp4.
  - **Done when:** tests green without network; documented estimate-only smoke command (`pnpm video:smoke`).
  - **Refs:** 18 §18.4, §18.7.
  - **Result:** `lib/src/providers/video/` (submit and `waitFor` split so a crashed run resumes by request id), `HIGGSFIELD_API_KEY` optional in `ai` env, `pnpm video:smoke`. Wiring into `ServiceContext` and the runtimes comes with M8-06, the first user of it.
- [x] **M8-03 · Reel director prompt** · P0 · L · deps: M8-01, M2-12b · ⚠ V-29
  - **Do:** `prompts/src/reel-director/v1.ts`, `ReelScript` schema, deterministic validators, one repair, eval set of 3 synthetic posts, fake responses, `generation_stage` values `REEL_DIRECTION` and `REEL_SHOT`; hooks from `docs/design/hook-library.md` (`ReelHookOption` holds a `hook_type` code from the shared taxonomy, 3 distinct hook types per script, banned patterns, CTA cards).
  - **Done when:** `pnpm eval` (fake) green; a live run recorded in the decision log; the owner reviewed 3 scripts.
  - **Refs:** 18 §18.4, 07 §7.5, `docs/design/hook-library.md`.
  - **Result (code, 2026-10-14):** stage `REEL_DIRECTION`; `prompts/src/reel-director/` (`reel-director@1`, schema, three synthetic posts as fixtures, snapshot); `modules/src/reels/director/` (`validateReelScript`, `directReel` = `runStage` with the validators and one repair, `toReelScriptDraft`); `ReelHookOption` got `hookType` (was `formula`) and `claimSlideIds`; `pnpm eval:reels` with a review sheet; domain `reels` in the dependency rules. Live run done (3/3 valid, $0.33, decision log 2026-10-14). The owner accepted the three scripts on 2026-10-14 (V-29 closed). The scripts were judged as text only: no video exists until M8-02/M8-05/M8-06 are in.
- [x] **M8-04 · Data model** · P0 · M · deps: M8-01
  - **Do:** migration 0009 (`reel_scripts`, `reel_shots`, `reel_renders`, `content_variants.source_variant_id` and `current_reel_render_id`), Drizzle schema, Zod shapes in `db/src/json/reels.ts`, RLS, schema tests.
  - **Done when:** migration reviewed by hand; schema tests green.
  - **Result:** `0009_reels.sql`, `db/src/schema/reels.ts` (`reel_shots`) and `reel_scripts` and `reel_renders` in `schema/content.ts`. The REEL variant state machine is not touched here: the `RENDER_CURRENT` guard and the `RE_RENDER` effect for Reels belong to M8-06 (generate) and M8-09 (approve and publish).
  - **Refs:** 18 §18.3, 04.
- [x] **M8-05 · Assembly renderer** · P0 · L · deps: M8-04 · ⚠ V-27
  - **Do:** `modules/src/reels/render/`: ffmpeg wrapper, text cards through the existing Chromium renderer, colour and box rules, cut grid, optional flash opener, audio mix; deterministic input hash.
  - **Done when:** unit tests on the filter graph; a golden-frame test with a fixture clip.
  - **Refs:** 18 §18.4, 08.
  - **Result (2026-10-14):** `modules/src/reels/render/`: `plan.ts` (the cut list: one segment per scene on the beat grid, the four-slice flash opener), `ffmpeg.ts` (one filter graph, strings only), `cards.ts` (Inter Tight cards through Chromium with a fit-text step and a safe-zone measure), `qa.ts` (ffprobe, blackdetect, first-second motion, `ReelQaReport`), `hash.ts` (the input hash), `assemble.ts` (cards → ffmpeg → checks, local files in and out), `pnpm reels:assemble <spec.json> <out.mp4>`. Tests: plan, graph, hash, QA parsers, Chromium cards, and real ffmpeg on synthetic clips with five golden frames (`__golden__/`, flat cards so no font dependence; rewrite with `UPDATE_GOLDEN=1`). **V-27 is not closed**: ffmpeg on Trigger.dev production machines (the build extension in `jobs/trigger.config.ts`, Chromium for the cards, memory and time of a 20 s render) is checked when M8-06 adds the job. Audio is taken as a file; the synthesized beat is M8-08.

- [ ] **M8-06 · Generate service and job J23** · P0 · L · deps: M8-02, M8-03, M8-04, M8-05
  - **Do:** `modules/src/reels/{estimate,generate,shots}.ts`, `jobs/src/tasks/generate-reel.ts` (queue `render`, large machine, resume, idempotency `reel:{variantId}:{requestId}`), audit events, setting `reels.enabled`.
  - **Done when:** an end-to-end test with fakes; one live run on a real post with its cost recorded.
  - **Refs:** 18 §18.4, 06.
  - **Result (code, 2026-10-14):** `modules/src/reels/generate/`: `estimate.ts` (shots × seconds × rate + the director, no model call), `shots.ts` (start frame 9:16 on white, shots found by prompt hash and reused, a RUNNING one waited for again, a refusal retried once with a still prompt, every vendor call a `generation_runs` row), `source.ts` (the carousel's slides and pictures as the director's input), `generate.ts` (director → shots → assembly, state persisted in `pipelineState`, resumes at its stage, PIPELINE_SUCCESS / PIPELINE_FAILURE through the state machine, audit `reel.generated` / `reel.failed`), `request.ts` (`estimateReelCost` and `requestReel`: the services behind the button, switch and confirmed estimate checked, the Reel variant created, J23 queued with `reel:{variantId}:{requestId}`), `enabled.ts` (`reels.enabled`, off by default, seeded false). `ServiceContext.video`, wired in the jobs runtime and the CLI. Task `generate-reel` (queue `render`, `large-1x`, 25 min); the ffmpeg build extension in `jobs/trigger.config.ts` (V-27 still to be checked on a deploy). Tests: shots, estimate, request, the job with fakes (success, reuse, hook choice, resume after a timeout, refusal and fallback, invalid script, running guard, render failure), and the job with real ffmpeg and Chromium.
  - **Open:** one live run on a real post with its cost (about $2.2 on Wan; needs `reels.enabled`, `HIGGSFIELD_API_KEY` and a funded balance), V-27 on the first deploy, and **M8-06a**.
- [ ] **M8-06a · Reuse one market's script for the other (Q-10)** · P1 · M · deps: M8-06
  - **Do:** pass the other market's Reel script as `baseScript` to the director (it keeps the scenes and writes only the cards), with the pictures of that script in `pictures` and the claims mapped to this market's slides. Today every market's Reel gets its own script and shots are reused only when the prompt and the picture are identical, so the Spanish Reel pays for its own shots.
  - **Done when:** the second market's Reel makes no new shots; a test with two markets.

- [ ] **M8-07 · UI: button, estimate dialog, progress, player** · P0 · L · deps: M8-06
  - **Do:** `ReelCard` on `/content/review/[ideaId]` and `/content/published/[publicationId]`; actions `estimateReel`, `generateReel`; progress from stages; player; regenerate one shot; change hook; download; en and ru.
  - **Done when:** component and E2E tests; i18n parity test green.
  - **Refs:** 18 §18.2, §18.6, 10.
  - **Result (2026-10-14):** `ReelCard` (`apps/web/src/components/review/reel-card.tsx`) in each market's column on `/content/review/[ideaId]`: Generate Reel with the estimate dialog (three models, the price read again from the server when the model changes, the confirmed price sent), the progress of a Reel being made (script, shots n of N, assembly, "taking longer than usual" after 15 minutes, a queued state), the video player (no autoplay), the download, the cost, the checks, the hook options with "Use this hook" (free: the shots are reused), the scenes with their shots and "Redo shot" with its price. Actions `estimateReel`, `generateReel`, `changeReelHook`, `regenerateReelShot` (owner and editor only). Services `getReelView`, `changeReelHook` and `regenerateReelShot` (a new script version, then J23 runs from the shots on: `scriptId` in the payload, `shotAttempt` in the scene and the shot hash). The review poller follows a Reel being made. Reel variants stay out of the carousel queues: the review bundle, the draft list and its tabs, the work-queue counters, the idea's variant list, the pipeline context and the "generate drafts" request now filter on `format = CAROUSEL` (Reels join the queues with M8-09). en and ru; 17 component tests, service tests, the i18n parity test.
  - **Open:** the **published post screen** (`/content/published/[publicationId]`, and the list) is still a placeholder, so the card is not there yet; **approve and reject** are M8-09 (done); **M8-07a** (done): the E2E spec and the `reels.enabled` screen.
- [x] **M8-07a · E2E of the Reel card and the Reels switch screen** · P1 · M · deps: M8-07
  - **Do:** E2E fakes for the web server (`createE2eLlm` answers `reel-director`, a video provider that returns a small real clip, a stub or a real ffmpeg), a spec: switch off → the button is off with its reason; switch on → estimate, confirm, progress, the video; change hook; redo a shot; a settings control for `reels.enabled`.
  - **Result (2026-10-15):** `scriptedReelScript` (the E2E model's answer for `reel-director`, valid for any carousel: tested against the real validators on the synthetic posts and on E2E-shaped carousels), `createE2eVideo` (the fake provider with a real 4 s mp4 per shot made by ffmpeg, a hue of its own per shot), `serverVideo()` in the web runtime for the inline job runner, the **Reels switch** on `/settings/ai` (`ReelsSwitch`, owners only, `setAppSetting`), and `apps/web/e2e/reels.e2e.ts`: off → reason, switch on in Settings, estimate and confirm, progress, a real Reel assembled by ffmpeg and Chromium, change hook (free), redo a shot (cost goes up), approve, the drafts queue and the calendar with a Reel badge, schedule and call off, withdraw, reject (1.8 min). The spec never switches a live `reels.enabled` off (see `docs/runbooks/e2e.md`). It found a real bug: `ReviewPoller` refreshed on a fixed timer, and on a slow page each refresh was replaced by the next before it arrived, so the card stayed on "making" for good; refreshes now never overlap (decision log 2026-10-15).
  - **Open:** the spec runs on a developer machine only (it needs ffmpeg, Chrome and the dev database), like the others.
- [x] **M8-08 · Audio** · P0 · M · deps: M8-05 · ⚠ V-28
  - **Do:** a synthesized placeholder beat synced to the cut grid (first release); mix with cut accents; the hook for owner-supplied licensed tracks (settings upload with a licence note and BPM) stays off until Q-08 is answered.
  - **Done when:** tests; loudness within limits.
  - **Refs:** 18 §18.4.
  - **Result (2026-10-14):** `modules/src/reels/audio/beat.ts`: the placeholder beat in code (port of the spike): `beatSchedule` (the pattern as data: kick and clap from the second scene, bass and hats under the hook, a pop on every cut, an impact before the PEAK scene, a riser out of the flash opener), `synthesizeBeat` (a deterministic mono 16-bit WAV, as long as the video, a 0.35 s fade at the end, soft clipping for level, peak −1.4 dBFS). `generate-reel` makes it from the script's scenes and passes it to the assembly (`audio_kind = PLACEHOLDER_BEAT`, its hash is part of the render's input hash). Measured with ebur128: −15.3 LUFS, true peak −1.1 dBTP. The slot for owner-supplied tracks (`OWNER_TRACK`, a settings upload with a licence note and BPM) is still not built; it waits for Q-08.

- [ ] **M8-09 · Review, scheduling and publishing** · P0 · L · deps: M8-06 · ⚠ V-25, V-26
  - **Do:** REEL through approve, schedule and calendar; `modules/instagram` REELS container, longer status wait, J10 format branch; mock Graph API cases; `pnpm ig:smoke --reel` (dry by default); `docs/runbooks/reels.md`; Gate **G3** record `docs/decisions/G3.md`.
  - **Done when:** a dry run reaches FINISHED on the test account; no live Reel before G3.
  - **Refs:** 18 §18.5, 09.
  - **Result (code, 2026-10-15):** migration `0010_reel_versions.sql` (a version points at a carousel render or a reel render); Reel branch of `approveVariant` and `verifyApprovedVersion` (`content/variants/reel.ts`), snapshot `format` and `reel`; `planReelDisclosure`; approve, reject, request changes, un-approve and the publishing panel on the Reel card; Reels in the drafts queue, counters and calendar (badge); `createReelContainer`, the publisher's REELS branch (video guards, 15-minute wait, one remake after a fetch error), the Graph mock's REELS container; `pnpm ig:smoke --reel`; `pnpm rc g3-check`; `docs/runbooks/reels.md`; `docs/decisions/G3.md`. V-25 checked.
  - **Open:** apply 0010, deploy, the Reel dry run on the test account (V-26), the owner's G3 decision, then the first live Reel.
- [x] **M8-10 · Insights for Reels** · P1 · M · deps: M8-09
  - **Do:** Reel metrics in snapshots and dashboards; link Reel to its source carousel.
  - **Result (2026-10-15):** the snapshots already held the Reel watch metrics (M6-02/03: `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate` in `video_metrics_json`). `modules/src/analytics/queries/reels.ts`: `reelWatch` (average and total watch time from milliseconds, skip rate from a percentage, hook rate = 1 − skip rate, completion = average watch time / the rendered Reel's length, capped at 1; a missing metric stays null), `pickD7` (the view's D7 rule in code, because the view has no video column), `getReelInsights` (each published Reel at D7 next to the carousel it was made from: reach, save and share rate of both; medians of views, watch time, hook rate, completion and Reel reach / carousel reach). The **Reels** section of the Engagement tab and watch tiles on a Reel's lineage page (`/content/published/[id]`); the Reel ↔ carousel links were there since M6-09. 3 module tests, 3 component tests.
- [x] **M8-11 · Trial Reels** · P1 · S · deps: M8-09
  - **Do:** `trial_params` toggle per Reel, off by default.
  - **Result (2026-10-15):** checked against Meta's IG User Media reference (2026-10-15): `trial_params` on the REELS container, an object with `graduation_strategy` `MANUAL` (graduated by hand in the Instagram app; the API has no call for it) or `SS_PERFORMANCE` (Instagram graduates it when it does well); REELS only; no field reads the trial state back. Migration `0013_trial_reels.sql`: `content_variants.trial_graduation` (null = a normal Reel; a check allows it on Reels only). `setReelTrial` (owners and editors, refused once the Reel is going out or out) and the **Trial Reel** select on the Reel card, off by default; the publisher sends `trial_params` as JSON on the REELS container (dry runs too, so the dry run checks it). 1 publishing test against the mock Graph API, 2 component tests. **The owner applies 0013 before this code is deployed.**

---

## G · Growth (Instagram promotion)

Why: the first week on the English account (2026-10-12…15, 2 followers) showed the carousels reaching 1–3 accounts each and the two Reels 16 and 30 within hours; 63–81 % of the Reel viewers left in the first three seconds; the Reels posted with the carousel's caption ("Swipe through 👉"); every post asked for a save and carried the same hashtag block. The strategy (owner's copy, not in git) puts Reels first and lists the cheap fixes below. Rules that hold for every task: nothing automated on other people's accounts (no follows, likes, comments or DMs), nothing audience-facing names the source brand.

- [x] **G-01 · The Reel's own post (reel-director@2)** · P0 · M · deps: M8-09
  - **Do:** reel-director@2 writes the Reel's caption (without its first line, which the code writes from the chosen hook and keeps in step when the hook changes), one ask that prefers SHARE or FOLLOW and rotates against the market's recent asks (a keyword ask tied to an offer is kept), 3–5 hashtags that reuse at most 2 of the recent block; flash opener ON by default; a doubt-about-a-habit hook recommended. Deterministic checks (no carousel words, no bait, no tags or links in the caption, the carousel's numbers only, the ask ends the caption, hashtag count and format). The review card shows the Reel's caption, ask and hashtags, editable by hand.
  - **Done when:** `pnpm check` and `pnpm eval:reels` (fake) green; a live Reel eval recorded in the decision log before the merge.
  - **Result (2026-10-16):** `prompts/src/reel-director/v2.ts`, `modules/src/reels/director/{caption,validate}.ts`, `generate.ts` (`savePost`), `request.ts` (hook change moves the first line), `content/variants/edit.ts` (a Reel's caption, CTA and hashtags can be edited; hook and slides cannot), Reel card block; `PIPELINE_VERSION` 1.8.0. Live eval 2026-10-16: 3/3 valid, $0.31 (decision log).
- [ ] **G-02 · Alt text on carousel images** · P0 · S · deps: M5-06 · ⚠ V-30
  - **Do:** send each slide's approved `altText` as `alt_text` of its carousel child container (images only; Reels have none).
  - **Done when:** tests; the next dry run on @chef.skk reaches FINISHED with alt text sent (V-30).
  - **Result (code, 2026-10-16):** `createChildContainer` takes the alt text (whitespace folded, cut to 1,000 characters, left out when empty); the publish machine passes each rendered slide the `altText` of its slide in the approved snapshot. **Open:** V-30 on the next dry run.
- [x] **G-03 · Account metrics are collected (V-11)** · P0 · S · deps: M6-03
  - **Do:** check the first runs of J12 (`collect-account-insights`, cron 02:17 UTC): `account_metric_snapshots` was still empty on 2026-10-15 22:35 UTC only because M6 went live that day and the job had not run yet. Close V-11 on the first rows (day boundary, follows vs unfollows); fix what they show.
  - **Done when:** a daily row per account; the dashboard shows the follower line.
  - **Result (2026-10-16):** the first run stored 14 Oct for @chef.skk (2 followers; follows and unfollows null). J12 now runs hourly and reads each account once its market's clock has passed 02:00, skipping a stored day (decision log). V-11 stays open for follows and unfollows.
- [ ] **G-04 · Carousel asks and hashtags (the next content-writer, after @7 of CV-04)** · P1 · M · deps: M7-04
  - **Do:** the carousel writer gets the market's recent asks and hashtags (as the Reel director does), rotates the goal of the post (save, send, comment, follow) and does not repeat the tag block; no engagement bait.
  - **Done when:** live eval (about $2.5, owner's yes) without regression; decision log.
- [ ] **G-05 · Spanish market live** · P0 · S · deps: owner
  - **Do:** connect the Spanish account, give the 7 waiting drafts their pictures and review them, first Reels on the English shots (M8-06a).
  - **Done when:** first Spanish posts and Reels published.
- [ ] **G-06 · Weekly growth report** · P1 · M · deps: M6-04
  - **Do:** per market and week: outlier multiple (reach / the account's median), share of non-follower reach, sends and saves per reach, follows per reach, Reel skip rate and average watch time; top and bottom five with a plain verdict ("profile problem" vs "hook problem"), honest about sample size.
  - **Done when:** a screen or a Markdown export the owner reads weekly.
- [ ] **G-07 · First-hour comment assistant** · P1 · M · deps: M6-03
  - **Do:** new comments on our posts of the last two hours, sorted (question, lead, praise, noise), a reply drafted in the market's language; a person sends it (`instagram_business_manage_comments`).
  - **Done when:** an inbox screen; replies are sent only by a click.
- [ ] **G-08 · Topic pillars and an opinion slot** · P1 · M · deps: M7-05
  - **Do:** the idea generator spreads ideas over pillars per market (grains, eggs, meat and doneness, roasted vegetables, sauces and the salt-acid-fat balance, kitchen myths) and plans one opinion post a week (the expert's position against a habit, with the reason, from the knowledge base only).
  - **Done when:** a week of ideas covers at least three pillars and one opinion.

## CV · Carousel v3 (pictures and posts)

Why: on 2026-10-17 the owner compared the English carousels with the Russian-language reference account: our pictures are fragments of one dark pot cut by the slide edge, the same object repeats on every slide, the text is thin and generic, and two layout bugs reached Instagram (text under a photo, a headline broken inside a word). Requirements and findings: `docs/design/carousel-v3-requirements.md` (P1–P9, T1–T8, C1–C2, Q1–Q4, owner decisions D1–D4).

- [x] **CV-01 · Photo placed by its measured box; layout checks** · P0 · M · deps: —
  - **Do:** measure the subject box of each generated picture on white (stored with the asset); templates B, D, E, F place the picture by that box in the slide's photo zone instead of fixed `translate` offsets and `place-*` classes (P2); render checks Q1 (no text over the photo), Q2 (no word broken inside a display slot; remove `overflow-wrap:break-word` there, fit-text shrinks to the longest word), Q3 (85 % of the subject inside). Template versions bump (render hash), goldens updated.
  - **Done when:** the wet rice and buckwheat carousels re-rendered from their stored pictures show whole subjects and no overlap or mid-word break; `pnpm check` and visual tests green.
  - **Result (2026-10-17):** `templates/src/framework/place-photo.ts` runs after fit-text in the slide page (live preview and render alike): subject box on white (1 % mass trimmed, contact shadow ignored), highlights lifted to white with an SVG table filter, 4 % feathered edges, largest scale whose box keeps 28 px from every text line (tight line boxes from `Range.getClientRects`), per-placement limits, 7 % bleed. Display slots no longer break inside a word (fit-text shrinks instead). Render QA: `pictures` measurements, overlap → TEXT_OVERFLOW, `croppedPictures` warning under 85 %. Templates 2.2.0. `pnpm --filter @rc/modules bench:carousel` renders a stored post from a JSON dump and its photos (the English bulgur carousel: no overlap, whole pans and bowls). Linux goldens come from the CI artifact.
- [x] **CV-02 · Pictures with a meaning (visual-director@7)** · P0 · M · deps: CV-01
  - **Do:** P1, P3–P7: `depicts`, new arrangements (`STAGES_STACK`, `MISE_EN_PLACE`, `PAIR`, `HERO_WITH_DEPTH`, `TOOL_IN_ACTION`), light vessels with colour from food instead of dark vessels, the changed style sentence and negative list; validator for same-state repeats and the dark-vessel limit.
  - **Done when:** live eval on two ideas (owner's yes) shows no repeated object and state, at most one dark vessel per carousel; decision log.
  - **Result (2026-10-17):** `prompts/src/visual-director/v7.ts` active (`PIPELINE_VERSION` 1.9.0); whole-subject compositions, style and negative list for briefs with a `vessel` (`photo-prompt.ts`); validator checks `VISUAL_DEPICTS_*`, `VISUAL_VESSEL_DARK`, `VISUAL_PICTURE_REPEATED`, `VISUAL_ARRANGEMENT_MONOTONOUS`; cut-outs normalized with white padding. Live on the wet rice and buckwheat carousels: $0.92 in total, no dark vessel, no repeat after validation (decision log). Dev tools: `spikes/carousel-v3/fetch-post.ts` (read-only dump of a variant, its pictures and recipe) and `spikes/carousel-v3/visual-bench.ts` (director + pictures without the database).
- [x] **CV-03 · Templates 3.0: ladder body, two-weight headline, closer, white cover** · P0 · M · deps: CV-01 · D1
  - **Do:** T3–T6 in the templates (line-per-row body, `lead` and `closer` slots, body up to 420 characters / 14 lines at 28–30 px in a 500 px column); P9 white cover template next to A.
  - **Done when:** goldens for every template; the owner picks the cover on rendered slides.
  - **Result (2026-10-17):** templates 3.0.0 (A–F): body 400 at 26–30 px in a 468 px column (B body 380 chars/13 lines, E 200 + 300, F 300), a blank line = half-line gap, `text-wrap: pretty`; B `lead` (400, 34–44 px) and `closer` (800 caps, 60 chars), E `closer`; headlines 46–72 px in a 600 px column; "Step 2" in ink; A subline 140 chars. White cover as a brand switch (`visual_system.cover = "white"`, D1 open; default dark). Line estimate counts a ladder gap as half a line. Body floor 26 px (decision log). `bench:carousel --cover white`.
- [x] **CV-04 · Arc of 8 and concrete text (market-adapter@4, content-writer@7)** · P0 · M · deps: CV-03 · D3
  - **Do:** T1 (roles USUAL_WAY, PORTION, CHECK or their mapping), T2 (a number per STEP, banned filler, one repair), T7 sign-off line from the market's brand settings, T8 hook, C1 caption with the method; merged with G-04 into one writer version so one eval covers both.
  - **Done when:** live eval (about $2.5, owner's yes) without regression on claims; decision log.
  - **Result (2026-10-17):** `market-adapter@4` (the arc of a lesson, usually 7–8 slides, mapped on PROBLEM/MISTAKE, EXPLANATION, FACT, STEP, SUMMARY) and `content-writer@7` (= v5 + ladder bodies filling 55–95 % of the slot, the cards' numbers and a visible cue on every step, no filler, lead and closer, red emphasis on at most half of the slides, the hook slide says what the carousel delivers, the sign-off line from the brand voice, the caption with the whole method) active, `PIPELINE_VERSION` 1.10.0. Built on v5 so the D7 learning of v6 stays off (`WRITER_LEARNING_VERSIONS` = {6}). `validateSubstance`: FILLER_PHRASE (MAJOR), THIN_SLIDE and STEP_WITHOUT_NUMBER (MINOR notes; the closed book wins). Live run on a private case of the owner's rice method: 9 slides, critic PASS, $0.94 text + $0.38 pictures (decision log). G-04 (asks and hashtags) moves to the next writer version. Dev tool: `spikes/carousel-v3/generate-post.ts`.
- [x] **CV-05 · Spike: hybrid edit (text slide first, food painted into the empty zone)** · P1 · S · deps: CV-01 · ⚠ mask support of `/v1/images/edits` for the current gpt-image model
  - **Do:** on one carousel render the final text slides, ask the image model to paint the food into the masked photo zone, compare side by side with the CV-01/CV-02 result; cost per slide measured.
  - **Done when:** the owner chooses D2 on the two contact sheets; decision log.
  - **Result (2026-10-17):** `spikes/carousel-v3/hybrid-edit.ts` on the rice step-2 slide, gpt-image-2.5-sunburst `/v1/images/edits` with a mask (accepted; $0.054 for one high 1024 × 1536 edit). The model's whole answer composes well (a whole steel pot right beside the text, natural shadow) but **re-draws the text** (one line squeezed to fit); keeping only the masked pixels **cuts the pot** where the model painted into the text area and leaves a faint grey block. Option C is not usable as is; A (measured placement, CV-01) stays. Decision log.
- [ ] **CV-06 · Lead magnet and keyword CTA for English** · P1 · S · deps: D4, G-07 or P2-04
  - **Do:** the offer (a free one-page sheet) in the database for the English market; the writer uses COMMENT_KEYWORD with numbered steps (C2); replies go out by hand from G-07 until a DM automation exists.
  - **Done when:** the first keyword post is published and its comments are answered.
- [ ] **CV-07 · Knowledge deep enough for a method (K1, K2)** · P0 · M · deps: owner (sources)
  - **Do:** the owner uploads the guides and a Markdown file of the methods of the Russian carousels (each with amounts, times, order, mistakes, limits) as GUIDE or NOTE sources; extraction, review and approval as usual; the idea generator's next version prefers ideas whose cards hold steps and numbers and turns a bare claim into a tip post.
  - **Done when:** at least 30 approved cards with procedure and numbers; the next five English ideas rest on them.
- [ ] **CV-08 · Reels: white page and a designed cover (R2, R3)** · P1 · S · deps: CV-03 · ⚠ `cover_url` on REELS containers
  - **Do:** lift each shot's page to white from its measured page colour instead of the fixed 0.9 level; render the Reel's cover as an A slide (white cover) with the hook and send it as `cover_url`.
  - **Done when:** a Reel dry run shows the designed cover in the grid preview; no grey page in the frames.
  - **Progress (2026-10-17):** R2 done: the assembly measures each clip's page from one frame (light, neutral ring pixels, lower quarter, `page-level.ts`) and lifts only the highlights from that level with a curve; a white page gets no lift (the fixed 0.9 levels brightened all food by about 11 %); renderer 1.1.0, Reel goldens updated. On the bulgur test clips every page measured about 0.99, so the grey of the accepted v6B file came from the spike's own build script, not from the production renderer. R3 (`cover_url` from the carousel's rendered first slide, kept in the approved snapshot, sent with the REELS container) not started: it touches the publish machine and needs Meta's parameter verified first.

## P2 · Post-MVP backlog (not scheduled)
- **P2-01** Reels Type A (talking video, narrower than M8, see `docs/plan/18-reels.md`): transcription provider, localized subtitles/script, ffmpeg render (Trigger.dev ffmpeg extension), REELS publishing [S§14.1].
- **P2-02** Reels Type B voice-over: localized voice-over for the M8 video-first Reels [S§14.2].
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
