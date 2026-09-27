# 02 · System diagram and component responsibilities

Spec §23.1 item 2. The MVP loop from [S§1.1] maps to components like this:

| Loop step [S§1.1] | Component (package / module) | Main job(s) | Main tables |
|---|---|---|---|
| SOURCE | `modules/knowledge` (sources, ingestion) | `ingest-source` | `source_assets`, `source_pages`, `source_chunks` |
| KNOWLEDGE | `modules/knowledge` (extraction, cards, retrieval) | `extract-knowledge-batch`, `embed-knowledge-items` | `knowledge_items`, `knowledge_item_versions` |
| MASTER IDEA | `modules/content` (ideas) | `generate-ideas` | `master_ideas`, `master_idea_knowledge` |
| LOCAL VARIANT | `modules/localization` + `modules/content` (pipeline) | `generate-content`, `regenerate-field` | `content_variants`, `generation_runs` |
| VISUAL | `modules/visuals` + `templates` | `generate-visual-assets`, `render-carousel` | `visual_assets`, `carousel_renders`, `rendered_slides` |
| QA | `modules/content` (validators, critic) + `modules/visuals` (render QA) | inside `generate-content`, `render-carousel` | `content_variants.critic_report`, `carousel_renders.qa_report` |
| HUMAN APPROVAL | `modules/content` (review, versions) + `apps/web` review screen | – | `review_events`, `content_variant_versions` |
| INSTAGRAM | `modules/publishing` + `modules/instagram` | `publish-dispatcher`, `publish-content` | `publications`, `publish_attempts`, `social_accounts` |
| ANALYTICS | `modules/analytics` (snapshots, queries) | `collect-insights`, `collect-account-insights` | `metric_snapshots`, `account_metric_snapshots` |
| LEARNING | `modules/analytics` (summaries) → `modules/content` (idea generator input) | `build-performance-summary` | `performance_summaries` |

## 2.1 Component diagram

```
┌──────────────────────────── apps/web (Next.js on Vercel) ────────────────────────────┐
│ UI pages (RSC + client)  │  Server Actions (thin)  │  Route Handlers (OAuth, callbacks,│
│                          │                         │  slide preview, health)          │
└──────────────┬───────────────────────┬──────────────────────────┬────────────────────┘
               │ call services          │ JobRunner.trigger()      │
               ▼                        ▼                          │
┌──────────────────────────── @rc/modules (domain services) ──────┴───────────────────┐
│ core: ServiceContext · audit · state-machine helper · error mapping                  │
│ knowledge │ content │ localization │ visuals │ offers │ publishing │ instagram │      │
│ analytics │ ai (runStage, cost, repair)                                              │
└───────┬──────────────┬───────────────┬────────────────┬─────────────────────────────┘
        │              │               │                │          ▲ same services
        ▼              ▼               ▼                ▼          │
   @rc/db         @rc/lib         @rc/prompts      @rc/templates  ┌┴──────────── jobs (Trigger.dev) ──────────┐
   Drizzle        providers,      versioned        React slide    │ thin task wrappers: parse payload →        │
   schema,        logging,        prompts +        templates,     │ call service → classify errors → retry /   │
   client,        security,       output           theme, fonts,  │ abort                                      │
   migrations     validation,     schemas          HTML renderer  └────────────────────────────────────────────┘
                  errors, env
External: Supabase Postgres + pgvector + Auth · Cloudflare R2 · Anthropic · OpenAI · Instagram Graph API · Sentry
```

## 2.2 Responsibilities

| Component | Responsibility | Owns (writes) | Depends on | Runs in |
|---|---|---|---|---|
| `apps/web` | Pages, forms, review UX, calendar, dashboards. Server actions validate input and call services. No business rules here. | – | modules, lib | Vercel |
| `jobs` | Trigger.dev task definitions, schedules, queues, retries. No business rules here. | – | modules, lib | Trigger.dev |
| `modules/core` | `ServiceContext` (db, logger, clock, user/actor, storage, providers, jobs). Audit writer. Generic conditional status transition. Error → action result mapping. | `audit_events` | db, lib | both |
| `modules/knowledge` | Source registration and upload, rights gate, parsing, pages, chunks, extraction batches, quote verification, cards CRUD and review states, versions, dedupe, retrieval | `source_*`, `knowledge_*`, `historical_posts` | ai, core | both |
| `modules/offers` | Products, market offers, campaign IDs, UTM builder | `products`, `offers` | core | both |
| `modules/localization` | Market profiles, unit conversion and numeric fidelity, cross-market differentiation checks | `markets` (profile fields) | ai, core | both |
| `modules/content` | Master Ideas, variant pipeline (adapter → writer → validators → critic loop), field edits and regeneration, state machine, approved snapshots, review events, voice examples | `master_ideas`, `master_idea_knowledge`, `content_variants`, `content_variant_versions`, `review_events`, `voice_examples` | knowledge, localization, offers, visuals (brief only), ai, core | both |
| `modules/visuals` | Visual director orchestration, image generation and normalization, library assets, render orchestration and render QA | `visual_assets`, `carousel_renders`, `rendered_slides` | templates, ai, core | jobs (render); both (rest) |
| `modules/publishing` | Scheduling, dispatch, publish state machine, safeguards, kill switch | `publications`, `publish_attempts` | content, instagram, core | both |
| `modules/instagram` | Graph API client, OAuth, token exchange/refresh/encryption, containers, publish, insights, limits, error classification | `social_accounts`, `integration_events` | lib (crypto), core | both |
| `modules/analytics` | Snapshot schedule, metric normalization, dashboard queries, attribution import, performance summaries | `metric_snapshots`, `account_metric_snapshots`, `attribution_events`, `performance_summaries`, `experiments` | publishing, instagram, content, core | both |
| `modules/ai` | `runStage()`: load prompt → render → call provider → validate → repair once → log `generation_runs` with cost | `generation_runs` | prompts, lib providers | both |
| `prompts` | Versioned prompt definitions + input/output Zod schemas + registry | – | lib (zod) | both |
| `templates` | Template registry (slots, limits), React slide components, theme tokens, fonts, `renderSlideHtml()`, in-page fit-text script | – | – (pure) | both |
| `db` | Drizzle schema, JSON types, migrations, clients (postgres.js, PGlite), seeds | schema | lib (env) | both |
| `lib` | Env loading, logging + redaction, errors, crypto, provider interfaces + adapters (LLM, embeddings, image, storage), small utils | – | – | both |

## 2.3 Main runtime flows

**A. Source → Knowledge** (M1)
1. User fills the upload form (type, language, rights). Server action creates `source_assets` (PENDING_UPLOAD) and returns a presigned PUT URL.
2. Browser uploads the file directly to R2. Server action `completeSourceUpload` checks the object and sets UPLOADED.
3. If rights allow AI processing → job `ingest-source`; otherwise status BLOCKED.
4. `ingest-source`: sniff type → parse pages → plan page-range batches → `extract-knowledge-batch` × N (waits for all) → quote verification → embeddings → dedupe suggestions → READY.
5. Chef reviews cards (evidence shown next to each card) → CHEF_APPROVED (version snapshot).

**B. Idea → ES/EN drafts** (M2)
1. `generate-ideas`: approved cards (diverse sample) + recent ideas + offers + market notes (+ performance summary from M7) → PROPOSED ideas.
2. Editor accepts an idea → `generateVariants` creates one DRAFT variant per active market → job `generate-content`.
3. Pipeline: market adapter per market (second market gets the first market's plan as "do not copy") → writer per market (parallel) → deterministic validators (+1 repair) → cross-market differentiation → critic (≤ 2 rewrites) → visual director → READY_FOR_REVIEW (+ flags).

**C. Visuals → render** (M3)
1. `generate-visual-assets` creates images for slots that need them → normalized in R2.
2. `render-carousel` builds slide HTML → Chromium screenshots → QA (overflow, glyphs, sizes, logo box) → JPEG 1080×1350 → R2 → `current_render_id`.

**D. Review → approve → schedule** (M4)
1. Reviewer edits a field or regenerates it → `review_events` row, re-render.
2. Approve → immutable `content_variant_versions` snapshot (with the exact render). Commercial variants get a `campaign_id`.
3. Schedule → `publications` row (SCHEDULED) with a unique idempotency key.

**E. Publish** (M5)
1. Every minute `publish-dispatcher` claims due publications (SKIP LOCKED) → `publish-content` (global idempotency key; one at a time per account).
2. `publish-content`: safeguards → child containers → carousel container → wait until FINISHED → `media_publish` → permalink → PUBLISHED. Each step is persisted, so a restart resumes and never posts twice.

**F. Measure → learn** (M6–M7)
1. Hourly `collect-insights` stores due media snapshots; daily `collect-account-insights` stores account metrics.
2. Dashboards read views that join publication → variant → idea → knowledge.
3. Weekly `build-performance-summary` writes a compact "performance memory" per market. The idea generator and writer read it.

## 2.4 Dependency rules (enforced by M0-20)
- `apps/web` and `jobs` import only from `@rc/modules/*` subpaths, `@rc/lib`, `@rc/templates` (preview), and types.
- `@rc/modules` may import `@rc/db`, `@rc/lib`, `@rc/prompts`, `@rc/templates`. Never `apps/*` or `jobs`.
- Inside modules: `content` → (`knowledge`, `localization`, `offers`, `visuals`, `ai`); `publishing` → (`content`, `instagram`); `analytics` → (`publishing`, `instagram`, `content`). No cycles. `core` depends on nothing inside modules.
- `@rc/templates` is pure (no db, no network). `@rc/prompts` has no side effects.
- The web app never imports `modules/visuals/render` (Chromium) except through `InlineJobRunner` with a dynamic import (test/dev only).
