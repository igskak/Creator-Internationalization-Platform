# 01 · Architecture decisions

Spec §23.1 item 1 (§23 item 1). Decisions are numbered **D-xx** and used across the plan.
Decisions marked **(material)** change the shape of the code. Confirm them before M0 ends (spec §22 asks to flag them).
Legend: [S§x] = from the spec · ⚠ V-xx = verify against current official docs before coding (list in 16 §16.4).

## 1.1 Decision summary

| ID | Area | Decision | Main reason | Main trade-off |
|---|---|---|---|---|
| D-01 | Architecture style | Modular monolith in one pnpm workspace. TypeScript end to end. No microservices. | [S§23.2]; 1–2 engineers; one domain model | Module boundaries are enforced by rules and CI, not by the network |
| D-02 | Web app | Next.js (App Router, current stable major) on Vercel, region `fra1` | [S§4.1]; server actions remove a separate API service | Vercel limits (4.5 MB request body, max duration) ⚠ V-21 → heavy work runs in jobs |
| D-03 | Database | Supabase Postgres (EU / Frankfurt) + pgvector. Server-only access with Drizzle ORM. RLS on, no policies (deny-by-default for the public Supabase API) | [S§4.1]; one store for relational data and vectors | Supabase client-side data features are not used |
| D-04 | Schema & migrations | Drizzle schema in TS. drizzle-kit SQL migrations in `db/migrations`. PGlite (Postgres in WASM with pgvector) for tests | Typed queries. Tests run anywhere, incl. Claude Code cloud sessions, without Docker | PGlite is single-connection → concurrency tests need real Postgres in CI |
| D-05 **(material)** | Background jobs | **Trigger.dev (v4)** | Long tasks without serverless timeouts; Playwright/ffmpeg build extensions; retries; idempotency keys; cron; queues with per-key concurrency; run dashboard + alerts | Second deploy target; task code must stay thin |
| D-06 | Object storage | **Cloudflare R2** through the S3 API. One private bucket per environment. Access only through presigned URLs | [S§4.1, §19]; zero egress fees; S3-compatible | Meta must accept presigned URLs ⚠ V-14 (fallback: public bucket with unguessable keys for renders only) |
| D-07 | Internal auth | Supabase Auth, email magic link, sign-ups disabled, allowlist table `app_users`, 3 roles (`owner`, `editor`, `chef`) | 2–5 users [S§22]; no passwords | Production needs custom SMTP (the default Supabase mailer is rate-limited) ⚠ V-20 |
| D-08 **(material)** | LLM | Claude through the official SDK behind an `LLMProvider` interface. Default model **`claude-opus-5`** for every stage; model and effort configurable per stage | Quality first; low volume; structured outputs; native PDF input | One LLM vendor at launch; switching = one adapter + evals |
| D-09 **(material)** | Embeddings | OpenAI `text-embedding-3-large` with `dimensions=1536`, behind `EmbeddingProvider` ⚠ V-19 | Multilingual (RU/ES/EN); fits the pgvector HNSW limit (2,000 dims); same vendor as images | Changing dimensions = migration + re-embed job |
| D-10 | Image generation | `ImageProvider` interface. First adapter: OpenAI Images (gpt-image family) ⚠ V-19. Bake-off against one alternative before M3 is done (M3-15) | Two AI vendors in total (fewer contracts and data reviews) | Photo-realism may favour another model → add a second adapter |
| D-11 **(material)** | Embedding placement | Inline `embedding vector(1536)` on `knowledge_items` (as in the spec) and on `source_chunks` (P1). Extra columns `embedding_model`, `embedding_hash` | Small corpus (< 50k rows); simplest queries | Model change needs a re-embed job (planned) |
| D-12 | Document extraction | PDF: `unpdf` (per-page text) + `pdf-lib` (page-range split) + Claude native PDF input per page range. DOCX: `mammoth`. TXT/MD/SRT/VTT: own parsers. CSV: `papaparse`. Type sniffing: `file-type` | No OCR vendor; page-accurate references; tables and scans handled by the model | Vision tokens on every page cost more (fine at our volume, see 1.5) |
| D-13 **(material)** | Carousel renderer | HTML/CSS templates as React components. Final render with Playwright (Chromium) inside Trigger.dev. `sharp` for JPEG export | Full CSS; DOM-based overflow checks; preview uses the same HTML as export | Chromium is heavy → jobs only, queue concurrency 2 |
| D-14 **(material)** | Instagram API path | "Instagram API with Instagram Login" (no Facebook Page needed), Standard Access for own accounts ⚠ V-01 | Simplest setup for new market accounts; enough for publish + insights | Features that need Facebook Login (not in MVP scope) stay unavailable |
| D-15 | Meta isolation | All Meta specifics in `modules/instagram` (adapter). Graph API version pinned in env | [S§9.1] | – |
| D-16 **(material)** | Knowledge language | Knowledge Cards keep the source language (mostly Russian). Master Ideas are written in English (internal working language). Variants are written in es-ES / EN | No translation step inside the "approved truth"; Sergey approves in the original language | Native ES/EN reviewers need an English gloss of cards (P1, marked non-authoritative) |
| D-17 | UI kit | Tailwind CSS + shadcn/ui (Radix), TanStack Table, React Hook Form + Zod, Recharts, sonner | Fast admin UI | – |
| D-18 | Secrets & tokens | Secrets in environment variables per environment. Instagram tokens encrypted with AES-256-GCM in app code, key versioning (`enc:v1:`) | [S§19] | Key rotation needs a re-encrypt script (H-02) |
| D-19 | Validation | Zod v4 for env, actions, JSON columns, LLM input/output | One schema language across the stack | – |
| D-20 | Observability | pino JSON logs with redaction; Sentry (web + jobs); Trigger.dev dashboard + alerts; domain logs (`audit_events`, `generation_runs`, `publish_attempts`, `integration_events`); Health page | [S§19, §23 item 13] | – |
| D-21 | Testing | Vitest (unit + integration with PGlite and MSW), Playwright Test (E2E + visual regression), prompt eval harness | Deterministic CI with no paid API calls | Evals cost money → run manually or nightly |
| D-22 | Statuses & vocabularies | Postgres enums for state machines. `taxonomy_terms` table for vocabularies that evolve (categories, angles, hook types, CTA types, visual styles, reason codes) | Stable states; analytics needs controlled vocabularies, not free text | Taxonomy codes validated in app code |
| D-23 | Environments | `dev` (local + Vercel Preview) and `prod`. Separate Supabase projects, R2 buckets, Trigger.dev environments, Meta apps, API keys | No production publishing from dev | Two sets of configuration |
| D-24 | Analytics snapshots | Media snapshots at +2 h, +1 d, +3 d, +7 d, +28 d. Account snapshot daily. D7 is the standard for comparisons | [S§12.1]; tiny API cost (see 11 §11.2) | "Final" numbers arrive after 28 days |
| D-25 | Jobs in tests and local dev | `JobRunner` interface with two modes: `trigger` (Trigger.dev) and `inline` (same service code, in-process) | E2E tests and local dev without Trigger.dev | Both paths must stay tested |

## 1.2 Details for material decisions

### D-05 Trigger.dev instead of Inngest
- **Why Trigger.dev.** Tasks run in Trigger.dev containers, not in Vercel functions. So:
  - a 15-page PDF extraction call or a 10-slide render has no serverless timeout;
  - Chromium comes from the Playwright build extension; ffmpeg (Reels, post-MVP) from the ffmpeg extension;
  - retries with backoff are declarative; `AbortTaskRunError` stops retries on permanent errors;
  - idempotency keys with **global scope** protect publishing (raw string keys default to *run* scope since v4.3.1 ⚠ V-17);
  - `wait.for()` pauses while we poll Meta container status without burning compute;
  - queues + `concurrencyKey` give "one publish at a time per Instagram account";
  - cron schedules cover dispatch, insights, token refresh;
  - the run dashboard and alerts give job monitoring with no extra work.
- **Why not Inngest.** Inngest is very good for event choreography, but its steps execute inside our own Vercel functions. Chromium packaging and function duration limits would become our problem. We need little event fan-out.
- **Mitigations.** Task files are thin wrappers around `@rc/modules` services (runner can be replaced). CI runs migrations, then `trigger deploy`, then the web deploy. Payload schemas are Zod-validated and only change in additive ways.
- **Revisit if** pricing or limits block us, or a company policy requires self-hosting (Trigger.dev can be self-hosted).

### D-06 R2 instead of S3
R2 has no egress fees. This matters for Meta fetching every slide, for admin previews and later for video. The S3 API is compatible, so we use `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. Choosing S3 later is a configuration change. Choose S3 now only if company policy requires AWS.

### D-08 Claude as the first LLM
- Default model `claude-opus-5` for all stages. We do not downgrade models for cost without an eval that shows equal quality (owner decision, see H-05).
- Per stage we set `effort` (`medium` for extraction and visual direction; `high` for ideas, market adaptation, writing, critic) and use adaptive thinking.
- Current Claude models do not accept `temperature`. The `LLMProvider` interface therefore has no temperature. Variety comes from the prompt (for example "propose 8 ideas with different angles").
- Structured output: `client.messages.parse()` with a Zod schema (`zodOutputFormat`). Long outputs (extraction) use streaming with the same schema, then Zod validation of the final text.
- Always check `stop_reason` (`refusal`, `max_tokens`) before reading the output. Enable the server-side refusal fallback as documented at implementation time.
- Citations cannot be combined with structured outputs (API returns 400). We get traceability another way: the model returns a verbatim quote + page, and code verifies the quote against the page text (07 §7.3).
- Load the `claude-api` skill in Claude Code when implementing the adapter (M1-08); do not rely on memory for SDK calls ⚠ V-18.

### D-09 / D-10 Embeddings and images from OpenAI
Two AI vendors (Anthropic, OpenAI) mean fewer contracts, data-processing reviews and keys. Alternatives kept behind the interfaces: Voyage AI or Google for embeddings; FLUX (Black Forest Labs / fal.ai) or Google Imagen for images. The M3-15 bake-off decides the image model with real visual briefs.

### D-11 Where embeddings live
- `knowledge_items.embedding` — the main retrieval target (approved cards only are used for generation).
- `source_chunks.embedding` — raw source passages for search and evidence (P1).
- A separate embeddings table would help only with many models at once. We do not need that in MVP. A model change runs the re-embed job (M1-16) and a migration if the dimension changes.

### D-12 Extraction libraries and fallbacks

| Input | Primary path | Fallback | Reference stored |
|---|---|---|---|
| PDF with text layer | `unpdf` page text → `source_pages`; Knowledge Cards from Claude with the page-range sub-PDF (made with `pdf-lib`) | Text-only extraction from page text if the PDF call fails or is too large | page range + verbatim quote |
| Scanned PDF / image pages | Claude PDF input (vision) | P1: vision transcription of pages into `source_pages` so quote checks work; until then cards get flag `QUOTE_UNVERIFIED` | page range + quote (unverified) |
| DOCX | `mammoth` raw text with headings → pseudo-pages of ~3,000 chars | – | section path + quote |
| TXT / MD | UTF-8, fallback cp1251 (legacy Russian files) via `iconv-lite` | – | section path + quote |
| SRT / VTT transcripts | Own parser → timed segments → pseudo-pages | – | start/end time + quote |
| Instagram posts | CSV/JSON import into `historical_posts` (P1) | – | external post id |
| Video / audio | Post-MVP (transcription provider) — rejected at upload with a clear message | – | – |
| Photos | Library assets (P1, M3-16) | – | – |

### D-13 Playwright instead of Satori

| Criterion | Playwright (Chromium) | Satori + resvg/sharp |
|---|---|---|
| CSS support | Full (grid, filters, `text-wrap: balance`, hyphenation) | Flexbox subset |
| Text overflow detection | DOM measurement per slot (`scrollHeight > clientHeight`) | Hard; no DOM |
| Preview = export | Same HTML in the browser iframe and in the renderer | Needs a second preview path |
| Fonts | WOFF2/TTF via `@font-face` | TTF/OTF/WOFF only |
| Runtime | ~1 GB RAM; runs in Trigger.dev with the Playwright extension | Tiny; runs anywhere |
| Speed | ~0.5–2 s per slide | ~0.1–0.3 s per slide |

Decision: Playwright. Rendering is asynchronous and low volume, so speed does not matter. Correctness checks (no clipping, glyph coverage, logo position) matter a lot [S§18]. Satori stays a fallback if we ever need edge rendering.

### D-14 Instagram API with Instagram Login
- No Facebook Page is needed. This is simpler for two new market accounts.
- Scopes (⚠ V-02): `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`.
- Long-lived tokens (~60 days) are refreshed when they are at least 24 h old ⚠ V-03. There is no non-expiring Page token like in the Facebook Login path, so a daily refresh job is required (M5-04).
- Standard Access should be enough because we publish only to accounts we own and manage (no App Review) ⚠ V-01. If this is wrong, App Review + Business Verification become a schedule risk — the Meta setup therefore starts in week 1 (Track B, B-11).

### D-16 Knowledge language
Sources are mostly Russian. Cards stay in the source language, so the approved truth is never a machine translation. Claude reads Russian cards and writes es-ES / EN copy directly. Master Ideas are in English because they are cross-market and the admin UI is English. Native ES/EN reviewers get an English gloss of each card on demand (M1-24, P1), clearly marked "not approved text".
Alternative (not chosen): translate cards to English at extraction. It adds a translation step whose errors would become "approved knowledge".

### D-07 Authentication for 2–5 users
Supabase Auth (email magic link). Public sign-ups are disabled. After login, the app checks the `app_users` allowlist and role. Roles: `owner` (settings, Instagram, rights, kill switch), `editor` (content work), `chef` (content work + knowledge approval). This is not granular RBAC [S§3.2]; it is one guard for chef approval and one for settings.

## 1.3 Key libraries

| Purpose | Library | Notes |
|---|---|---|
| Monorepo, language | pnpm workspaces, TypeScript (strict) | Node.js LTS supported by Vercel and Trigger.dev (22.x or 24.x) ⚠ V-21 |
| Lint / format | Biome | One fast tool |
| Web | Next.js, React, Tailwind CSS, shadcn/ui, TanStack Table, React Hook Form, sonner, Recharts | `serverExternalPackages` for `sharp`, `playwright-core` |
| Auth | `@supabase/ssr`, `@supabase/supabase-js` | Auth only, no data access |
| Data | `drizzle-orm`, `drizzle-kit`, `postgres` (postgres.js), `@electric-sql/pglite` (tests) | Pooler URL with `prepare: false` on Vercel ⚠ V-20 |
| Jobs | `@trigger.dev/sdk`, `@trigger.dev/build` (Playwright extension) | ⚠ V-17 |
| AI | `@anthropic-ai/sdk`, `openai` | Via provider interfaces only |
| Files | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `unpdf`, `pdf-lib`, `mammoth`, `file-type`, `iconv-lite`, `papaparse` | – |
| Rendering | `react-dom/server`, `playwright-core`, `sharp`, `fontkit` | Fonts bundled in the repo |
| Testing | `vitest`, `@playwright/test`, `msw`, `pixelmatch`, `pngjs` | – |
| Observability | `pino`, `@sentry/nextjs`, `@sentry/node` | – |
| Utilities | `zod`, `nanoid`, `p-limit`, `date-fns`, `@date-fns/tz` | – |

## 1.4 Deployment topology

```
                         ┌───────────────────────────── Vercel (fra1) ─────────────────────────────┐
 Browser (2–5 users) ───►│ Next.js app: UI (RSC) · Server Actions · Route Handlers                 │
                         │  - /api/instagram/oauth/*   - /api/meta/{deauthorize,data-deletion}     │
                         │  - /api/preview/slide       - /api/health                               │
                         └───────┬──────────────┬─────────────────────┬─────────────────────────────┘
                                 │ SQL (pooler)  │ trigger task (SDK)   │ presigned PUT/GET
                                 ▼               ▼                      ▼
             ┌──────── Supabase (EU) ───────┐  ┌──── Trigger.dev Cloud ────┐  ┌── Cloudflare R2 ──┐
             │ Postgres + pgvector          │◄─┤ Task workers (containers) ├─►│ private bucket    │
             │ Auth (magic link)            │  │ incl. Chromium (render)   │  │ sources/ assets/  │
             └──────────────────────────────┘  └─────┬───────┬───────┬─────┘  │ renders/ imports/ │
                                                     │       │       │        └────────▲──────────┘
                                         Anthropic API  OpenAI API  Instagram Graph API │
                                         (LLM)          (embed/img) (publish, insights) │
                                                                     │  Meta fetches JPEGs via
                                                                     └──── presigned GET URL ──┘
 Sentry ◄── errors from web + jobs          ManyChat (external, configured by hand; we generate keywords + UTMs)
```

**Environments**

| | dev | prod |
|---|---|---|
| Web | local `next dev` + Vercel Preview | Vercel Production |
| DB | Supabase project `regchef-dev` (or local PGlite for tests) | Supabase project `regchef-prod` (EU) |
| Jobs | Trigger.dev `dev` (local CLI) / `staging` | Trigger.dev `prod` |
| Storage | R2 bucket `regchef-dev` | R2 bucket `regchef-prod` |
| Meta | Meta app in Development mode, test IG accounts | Meta app Live (Standard Access), ES + EN accounts |
| Publishing | `INSTAGRAM_PUBLISH_MODE=off` or `dry_run_only`; live only for test accounts | `live` after Gate G2 |

**CI/CD flow.** Pull request → lint, typecheck, unit + integration tests, web build (+ visual regression if templates changed). Merge to `main` → apply DB migrations (expand-only) → `trigger deploy` → Vercel production deploy. Migrations follow expand → migrate → contract, so web and jobs can run for a short time against a newer schema.

## 1.5 Cost envelope (rough, for planning only)

Prices: Anthropic from the `claude-api` skill cache (June 2026: `claude-opus-5` $5 / $25 per million input / output tokens). OpenAI prices ⚠ V-19. Numbers include a margin for thinking tokens.

| Work item | Estimate |
|---|---|
| Knowledge extraction, 200-page book (PDF input ~2.4k tokens per page, ~150k output tokens) | ≈ $6 per book |
| One Master Idea → ES + EN variants (adapter, writer, critic, 1 rewrite, visual director) | ≈ $1 |
| Images, ~6 per variant × 2 markets | ≈ $0.5–2.5 per idea (depends on model and quality) |
| Embeddings | < $1 per month |
| Total at 3 posts per day per market | ≈ $10–15 per day of AI spend |

Every AI call logs tokens and cost in `generation_runs`. The Settings → AI page shows month-to-date cost (H-05 adds a budget alert).
