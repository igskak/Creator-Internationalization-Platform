# 16 · Risks, assumptions, spec corrections and verification list

Spec §23.1 item 16 (§23 item 17). Also covers §22 ("flag choices that materially affect architecture") and §23.2 ("mark the exact item to verify against current official documentation").

## 16.1 Risks

| ID | Risk | Impact | Likelihood | Mitigation | Owner |
|---|---|---|---|---|---|
| R-01 | ES/EN content is not good enough (reads translated, weak voice) | High | Medium | S-01 spike in week 1–2; Gate G1 before publishing work; eval harness; native reviewers early (B-09); voice guide and examples (B-08); market notes | Ihor |
| R-02 | Unsupported or invented chef claims get published | High | Medium | Closed-book generation on approved cards; citation per factual slide; numeric fidelity check; critic; human approval checklist; safety flags | Ihor / Sergey |
| R-03 | Poor extraction from complex or scanned PDFs (tables, photos of pages) | Medium | Medium | Claude PDF (vision) input per page range; quote + number verification; page transcription (P1); manual cards; per-source report in M1-25 | Engineer |
| R-04 | ES and EN variants are near-translations of each other | Medium | Medium | Sequential planning with sibling constraints and random order; differentiation metrics; critic dimension; human check at G1 | Engineer |
| R-05 | Meta access or API differs from assumptions (Standard Access not enough, scopes or limits changed) | High | Low–Medium | Start Meta setup in week 1 (B-11); M5-00 verification before coding; adapter isolation; dry runs; smoke tests. If App Review is required, add 2–6 weeks of buffer to M5 | Ihor |
| R-06 | Wrong, duplicate or unapproved post | High | Low | Approved snapshot bound to render; safeguards; unique indexes; global idempotency keys; reconciliation; kill switch; env allowlist; G2 idempotency drill | Engineer |
| R-07 | Token expiry or revocation silently stops publishing | Medium | Medium | Daily refresh; health checks; banners; warnings on scheduled posts; alerts; re-auth runbook | Engineer / Ihor |
| R-08 | Too little data → the learning loop learns noise | Medium | High | D7 standard; minimum sample; "directional" labels; experiments-lite; M7 built when data exists (P1) | Ihor |
| R-09 | New accounts grow slowly, so metrics stay small for weeks | Medium | High | Business expectation, not a code issue; compare rates, not counts; keep posting cadence | Ihor / Sergey |
| R-10 | Rendering defects (clipped text, missing glyphs, inconsistent logo) | Medium | Medium | Slot limits shared by prompts/validators/templates; fit-text; glyph checks; render QA; visual regression | Engineer |
| R-11 | AI images look fake or off-brand | Medium | Medium | Bake-off (M3-15); prefer library photos (P1); templates that work with little imagery (B, E, F); human review; visual QA (P1) | Sergey |
| R-12 | Vendor or model changes / deprecations | Medium | Medium | Provider interfaces; model ids in config; evals before switching; pinned SDK versions | Engineer |
| R-13 | AI cost higher than expected | Low | Low | Cost per call logged; budget alert (H-05); effort tuning after evals; Batch API (P2) | Ihor |
| R-14 | Rights are unclear, so real sources stay BLOCKED | High | Medium | Rights matrix (B-04) in week 1; explicit rights form; BLOCKED state visible with reason | Ihor + Sergey |
| R-15 | Scope creep (Reels, France, ManyChat API, auto-publishing) | Medium | High | P0/P1/P2 labels; G1 before breadth; changes only through `decision-log.md` | Ihor |
| R-16 | Architecture drifts across many Claude Code sessions | Medium | Medium | `CLAUDE.md`; small tasks with refs; CI gates; dependency rules (M0-20); PR review; decision log | Engineer |
| R-17 | The repository is **public** today: internal plan, Reg.Chef IP or secrets could leak | High | Medium | Make the repo private (B-01) before adding the spec or any real content; synthetic fixtures only; secret scanning; git-ignored outputs | Ihor |
| R-18 | Outage of Trigger.dev, Vercel, Supabase or Meta | Medium | Low | Retries; visible failures; dispatcher recovery; manual-posting runbook (post by hand, record media id) | Engineer |
| R-19 | Compliance gaps: AI imagery disclosure, food-safety claims, Meta data deletion | High | Medium | Legal review B-13 before G2; `SAFETY_REVIEW` flag and checklist; Meta callbacks; disclosure option (M5-12) | Ihor |
| R-20 | Chef review is the bottleneck (cards pile up in NEEDS_REVIEW) | High | High | Review queue order (verified quotes first, focus categories); bulk approve for clean cards; agreed weekly review time (A-20); only cards needed for the next ideas are urgent | Sergey / Ihor |

## 16.2 Assumptions (change one → check the listed impact)

| ID | Assumption | Impact if wrong |
|---|---|---|
| A-01 | 1 engineer (+ Claude Code), 2–5 app users (Ihor, Sergey, native reviewers). Estimates in 14 assume this | Timeline |
| A-02 | Sources are mostly Russian PDFs/DOCX owned by Reg.Chef; some are scans | Extraction cost and quality |
| A-03 | Sergey approves knowledge and reads the source language | D-16 |
| A-04 | Two new Instagram Professional accounts (ES, EN), one per market; the Russian account is not connected in MVP (historical posts via CSV) | Data model allows more later |
| A-05 | Carousels only; 5–10 slides; 1080 × 1350 JPEG | Templates, export |
| A-06 | Market defaults: **es-ES** — Spain, `es`, EUR, Europe/Madrid, METRIC; **en** — global/US-friendly, `en` (US spelling), USD, America/New_York, DUAL units (°F first, °C in brackets); **fr-FR** — inactive, EUR, Europe/Paris, METRIC | Prompts, formatting, scheduling |
| A-07 | Volume ≤ 3 posts per day per market; ≤ 50 ideas per week; ≤ 20k cards | Queues, costs, indexes |
| A-08 | Quality before cost in MVP; one top model for all stages; cost tuning only after evals | Cost envelope (01 §1.5) |
| A-09 | Admin UI in English only | i18n not needed |
| A-10 | No customer PII stored; attribution uses campaign ids and order ids/hashes | Privacy scope |
| A-11 | EU hosting (Supabase Frankfurt, Vercel `fra1`, R2 EU) | Data residency |
| A-12 | Brand fonts if licensed for embedding; otherwise OFL fonts | Look of slides |
| A-13 | ManyChat flows configured by hand in MVP | Attribution depends on discipline |
| A-14 | Localized offers may not exist at the start; first posts may be non-commercial | Commercial CTAs later |
| A-15 | Team emails known; magic-link login acceptable | Auth |
| A-16 | A Node.js LTS version supported by both Vercel and Trigger.dev exists (22 or 24) | Tooling |
| A-17 | Master Ideas are written in English (internal working language) | Prompts, UI |
| A-18 | Differentiation thresholds are placeholders until calibrated at G1 | False WARN/FAIL early |
| A-19 | Humans choose posting times in MVP (no automatic best-time slots) | Calendar scope |
| A-20 | The chef can review about 100–200 cards per week | Throughput (R-20) |

## 16.3 Corrections to the spec (§23: contradiction, compliance issue or missing dependency)

| ID | Type | Finding | Resolution in this plan |
|---|---|---|---|
| C-01 | Contradiction | Offers are market-scoped (`offers.market_id`) but `master_ideas.offer_id` is one value for a cross-market idea; `offers.source_product_id` points to a catalog that is not defined | New `products` table; `master_ideas.product_id`; `content_variants.offer_id` (market-scoped) |
| C-02 | Missing state | Reviewers can reject [S§7.2, §10.2], but REJECTED is not in the status list [S§7.4]; no in-flight state while publishing | Add `REJECTED` and `PUBLISHING` |
| C-03 | Missing dependency | Growth metrics (followers, non-follower reach) [S§12.3] are account-level; `metric_snapshots` is per publication | New `account_metric_snapshots` + daily job |
| C-04 | Missing dependency | Audit log [S§19], publish attempt log [S§11.1], AI versioning [S§23], renders [S§8], approved/generated separation [S§19], attribution events [S§13.1], historical posts [S§20], performance memory [S§12.4] have no tables | Tables added (04 §4.8) |
| C-05 | Security fit | `source_assets.file_url` suggests stored URLs; source IP must use signed/private URLs [S§19] | Store object keys; presign on demand |
| C-06 | Missing detail | Source traceability test [S§18] needs page + quote, not a free-text reference | Structured `source_reference` with verified quote |
| C-07 | Type mismatch | Review events store text, but slides are structured | `jsonb` values + field paths |
| C-08 | Inconsistency | Repo structure lists `carousel-a…c` [S§15]; template library lists A–F [S§8.1] | Implement A–F (A, B, E, F in P0) |
| C-09 | API limit | The Instagram app allows 20 carousel items, the API allows 10 (⚠ V-05) | Slide plans capped at 10 |
| C-10 | Compliance | AI-generated photo-realistic imagery may need disclosure (Meta policy; EU AI Act transparency rules — applicability and dates to be checked) | Legal review B-13; `is_ai_generated` tracking; disclosure option M5-12 |
| C-11 | Missing dependency (people) | The localization test [S§18] needs native reviewers; the knowledge flow needs regular chef review time | Track B B-09; A-20; R-20 |
| C-12 | Missing dependency | Commercial attribution needs localized offers and landing pages that may not exist | Track B B-07; A-14; first posts may be non-commercial |

## 16.4 Verification list (check against current official docs before the named task)

| ID | Item to verify | Before task | Where |
|---|---|---|---|
| V-01 | "Instagram API with Instagram Login" setup; Standard Access covers own accounts (roles / business portfolio); App Review not needed | M5-00 (start with B-11 in week 1) | Instagram Platform overview, access levels |
| V-02 | Scope names: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` | M5-00 | Instagram Login docs |
| V-03 | OAuth endpoints; short → long-lived exchange; token lifetime (~60 days); refresh rules (≥ 24 h old) | M5-00 | Business Login for Instagram; refresh_access_token reference |
| V-04 | Graph API version to pin; host `graph.instagram.com`; `Authorization` header support | M5-00 | API reference |
| V-05 | JPEG only; aspect 4:5–1.91:1; width 320–1440; ≤ 8 MB; carousel 2–10 items; crop to first item; caption ≤ 2,200 chars; ≤ 30 hashtags | M3-07 (export spec) and M5-00 | Content publishing docs |
| V-06 | Publishing limit (100 vs 50 per 24 h) and `content_publishing_limit` fields | M5-00 | Content publishing docs |
| V-07 | Container status values; polling guidance; container expiry (~24 h) | M5-00 | Content publishing docs |
| V-08 | Behavior of `media_publish` on an already-published container | M5-00 / M5-10 | Docs + smoke test |
| V-09 | Error codes and subcodes for publishing failures (rate limit, media fetch, invalid media, token) | M5-00 | Error reference + smoke test |
| V-10 | Media insights metric names for carousels; deprecated metrics (impressions, plays, video_views); new metrics | M6-02 | Insights docs (Instagram Login) |
| V-11 | Account insights metrics, `follow_type` breakdown, `metric_type=total_value`, follower thresholds | M6-02 | Insights docs |
| V-12 | Business Use Case rate limits for the Instagram Platform | M5-00 | Rate limiting docs |
| V-13 | Deauthorize and data-deletion callback requirements; `signed_request` format | M5-05 | App settings / data deletion docs |
| V-14 | Meta accepts presigned R2 URLs (with query strings) as `image_url` | M5-10 | Smoke test |
| V-15 | Whether media can be deleted through the API (assumed not) | M5-00 | API reference |
| V-16 | AI-content labeling options through the API; handling of provenance metadata | M5-12 / B-13 | Meta policy + API reference |
| V-17 | Trigger.dev: current major version; idempotency key scopes (raw strings = run scope since v4.3.1) and TTL (default 30 days); behavior when re-triggering after a failed run; Playwright extension; machine presets; `wait.for`; `batchTriggerAndWait`; regions | M0-14, M3-12 | Trigger.dev docs |
| V-18 | Anthropic: model ids (`claude-opus-5`), `messages.parse` + `zodOutputFormat`, PDF limits (32 MB, page limits), citations vs structured outputs, sampling params removed, refusal fallback | M1-08 | `claude-api` skill + Anthropic docs. **Verified 2026-10-03**, see decision-log |
| V-19 | OpenAI: embedding model and `dimensions`; image model name, sizes, pricing, usage policy; API data terms | M1-11, M3-03 | OpenAI docs. **Embeddings part verified 2026-10-03** (see decision log); **image part verified 2026-10-10** (see decision log) |
| V-20 | Supabase: pgvector + HNSW; pooler mode with `prepare: false`; Auth email OTP + custom SMTP; PITR by plan | M0-09, M0-15 | Supabase docs |
| V-21 | Vercel limits (request body 4.5 MB, max duration), region `fra1`, Node version; Next.js major (middleware vs `proxy.ts`) | M0-08 | Vercel / Next.js docs |
| V-22 | R2: presigned PUT and CORS; single PUT size limit; EU jurisdiction; public bucket option | M0-13 | Cloudflare docs |
| V-23 | Legal: EU AI Act transparency obligations (scope, dates); Meta AI-generated content policy | B-13 (legal) | Counsel |

Note: in this cloud environment the egress proxy blocked `developers.facebook.com` and `trigger.dev` while this plan was written. Allow these domains in the environment's Network access (B-14) or verify from a local machine.

## 16.5 Decisions to confirm (material to architecture)

| Decision | Default in this plan | What changes if you choose otherwise |
|---|---|---|
| D-05 Jobs platform | Trigger.dev | Inngest: steps run in Vercel functions → Chromium/duration work moves elsewhere; job code shape changes |
| D-08 LLM | Claude `claude-opus-5-5` for all stages | Another vendor: new adapter + prompt re-tuning + evals |
| D-09/D-10 Embeddings and images | OpenAI | Another vendor: adapter + (embeddings) migration and re-embed if dimensions differ |
| D-11 Embedding placement | Inline columns | Separate table: more joins, easier multi-model |
| D-13 Renderer | Playwright | Satori: no Chromium, but CSS limits and a second preview path |
| D-14 Instagram API path | Instagram Login | Facebook Login: Facebook Pages needed; different token model (Page tokens) |
| D-16 Knowledge language | Source language (RU) | English cards: translation step at extraction; Sergey reviews English |
| B-01 Repository visibility | Must become private before real content | If it stays public: keep spec, prompts with real examples and all IP out of git |

## 16.6 Open questions (non-blocking; default used until answered)

| ID | Question | Default |
|---|---|---|
| Q-01 | English market: US spelling and New York time zone? | Yes (A-06) |
| Q-02 | Must Sergey approve every post, or only knowledge? | Knowledge: chef only. Posts: any reviewer, but Sergey approves the first 3 per market (G2) |
| Q-03 | Hashtag policy | 3–5 per post |
| Q-04 | Posting cadence and default slots per market | Humans choose; minimum gap 3 h (warning) |
| Q-05 | Which products are localized first? | Lead magnets first (B-07) |
| Q-06 | Connect the Russian account through the API later for richer historical metrics? | Not in MVP; CSV import |
| Q-07 | Split English into US and UK later? | No |
