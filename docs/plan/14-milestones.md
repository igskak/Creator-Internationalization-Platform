# 14 · Milestones and Definition of Done

Spec §23.1 item 14 (§23 items 15 and 16). Milestones follow the spec phases [S§16]. Two quality gates are added: **G1** proves content quality before we invest in publishing and dashboards [S§23.2, §24 "implementation priority reminder"]; **G2** controls the first live posts.

## 14.1 Overview

| Milestone | Spec phase | Goal | P0 tasks | Rough effort* | Exit |
|---|---|---|---|---|---|
| M0 Foundation | Phase 0 | Repo, tooling, CI, env, DB, auth, storage, jobs, logging, shell, brand/markets | 19 | 6–9 days | DoD 14.2 |
| S-01 Spike (parallel) | – | Early signal on the core AI loop with one real source | 1 | 1–2 days | learnings logged |
| M1 Knowledge Engine | Phase 1 | Source → structured, traceable, reviewed Knowledge Cards | 20 | 9–13 days | DoD |
| M2 Content Engine | Phase 2 | Master Ideas → ES + EN drafts with critic loop | 17 | 9–12 days | **Gate G1** |
| M3 Creative Engine | Phase 3 | Visual briefs, images, deterministic carousel renderer, preview | 14 | 8–11 days | DoD |
| M4 Review + Calendar | Phase 4 | Field-level review, approval snapshots, scheduling, campaign IDs | 11 | 6–8 days | DoD |
| M5 Instagram | Phase 5 | Connect, publish safely, token health | 12 (+ M5-12 if legally required) | 6–8 days | **Gate G2** |
| M6 Analytics | Phase 6 | Snapshots, dashboards, lineage | 8 | 5–7 days | DoD |
| M7 Learning | Phase 7 | Performance memory fed into generation, experiments-lite | 0 (all P1) | 3–5 days | DoD |
| H Hardening | – | Health page, security review, runbooks, MVP acceptance | 4 | 3–4 days | **MVP sign-off** |

\* Focused engineering days for one engineer working with Claude Code, including review and tests. Excludes waiting on Track B items (Meta setup, reviewers, assets). Total P0 ≈ 55–75 focused days ≈ 12–16 calendar weeks. These are planning numbers, not commitments (A-01).

**Why M7 is P1.** The learning loop is in MVP scope, but it cannot be validated at MVP acceptance: it needs about 20 D7-measured posts per market. Build it when that data starts to exist; the data it needs is collected from M4 onward.

## 14.2 Milestones

### M0 · Foundation
- **Scope**: M0-01 … M0-19 (P0), M0-20, M0-21 (P1).
- **Definition of Done**
  - `pnpm check` is green in CI on `main`; CI runs on every PR.
  - Dev environment works: Vercel Preview + dev Supabase + dev R2 + Trigger.dev dev; `/api/health` returns ok.
  - Magic-link login works for allowlisted users; unknown emails are refused.
  - Seeds exist: Reg.Chef brand, es-ES and en active, fr-FR inactive, taxonomy, owner users, default settings (publishing disabled).
  - A test job triggered from the app writes an audit event, in both `inline` and `trigger` modes.
  - Logs are JSON with request ids; redaction tests pass; Sentry receives a test error without secrets.
  - Brand voice and market profiles can be edited in the UI (audited).
- **Acceptance checks**: CI run link; screenshot of login + shell; audit row for the test job; env validation test output.

### S-01 · Core AI quality spike (parallel with M0)
- **Scope**: S-01. Needs B-03 (API key), B-04 (rights for one source), B-05 (one real source).
- **Done**: outputs reviewed by Ihor and Sergey; quality, cost and latency notes in `decision-log.md`; prompt ideas carried into M1-12 and M2-09/10.

### M1 · Knowledge Engine
- **Scope**: M1-01 … M1-19, M1-25 (P0); M1-20 … M1-24 (P1).
- **Definition of Done**
  - A real PDF (≥ 100 pages) and a DOCX go from upload to READY with visible progress; failures show a reason and can be reprocessed.
  - Cards have category, claim, explanation, structured fields, page reference and a verbatim quote; quote verification and flags work.
  - A source whose rights do not allow AI processing is BLOCKED and makes no AI call (test).
  - The chef can edit, approve and archive cards; approval creates a version snapshot; approved cards are embedded.
  - Dedupe suggestions appear; retrieval returns diverse approved cards.
  - Every model call is in `generation_runs` with cost.
- **Acceptance checks**: E2E spec 1 green; real-source run report (pages, cards, % verified quotes, cost, time) in `decision-log.md`; 20 random cards spot-checked by Sergey for accuracy.

### M2 · Content Engine → Gate G1
- **Scope**: M2-01 … M2-16, M2-18 (P0); M2-17 (P1).
- **Definition of Done**
  - Ideas are generated from approved cards (and can be created by hand), each linked to exact card versions.
  - For an accepted idea, ES and EN variants are generated with market briefs, critic reports, flags, quality scores and a differentiation report.
  - Validators, numeric fidelity, repair and the critic rewrite loop work; a crash mid-pipeline resumes without repeating finished stages.
  - The draft viewer shows idea, cards and both variants side by side.
  - The eval harness produces G1 metrics and the blind human review export.
- **Acceptance checks**: integration tests for pipeline paths; one real idea generated end to end in dev; G1 record (below).

### M3 · Creative Engine
- **Scope**: M3-01 … M3-09, M3-11 … M3-15 (P0); M3-10, M3-16, M3-17 (P1).
- **Definition of Done**
  - Visual briefs exist per variant; images are generated, normalized and stored; required slots are filled.
  - Templates A, B, E, F render at 1080×1350 with brand fonts; QA catches overflow, missing glyphs, logo position, size.
  - Renders run in Trigger.dev (Chromium) and re-render automatically after text edits.
  - The review screen shows the rendered carousel; live HTML preview matches the export.
  - Visual regression tests run in CI; the image model choice is recorded (bake-off).
- **Acceptance checks**: 5 real variants rendered for each market; zero QA failures after fixes; golden images reviewed.

### M4 · Review + Calendar
- **Scope**: M4-01 … M4-11 (P0).
- **Definition of Done**
  - Reviewers edit or regenerate any single field; every change is a `review_events` row with original and new values and a reason code where given.
  - Approve / reject / request changes / unapprove follow the state machine; approval creates an immutable snapshot bound to the exact render; edits after approval cancel scheduled posts.
  - Commercial variants get a campaign id, UTM link and the ManyChat checklist.
  - Approved content can be scheduled, rescheduled and cancelled in the calendar.
  - E2E spec 3 green.
- **Acceptance checks**: demo of the full review → schedule flow; DB check that the snapshot matches the render hash.

### M5 · Instagram → Gate G2
- **Scope**: M5-00 … M5-11 (P0); M5-12 (P0 if the legal review requires disclosure, else P1).
- **Definition of Done**
  - All ⚠ Meta items verified and recorded (M5-00).
  - ES, EN and test accounts connect through Instagram Login; tokens are encrypted, refreshed daily and health-checked; callbacks work.
  - The publish state machine runs with safeguards, idempotency and reconciliation; dispatcher cron; dry run; kill switch; environment guards.
  - Smoke test passed on a test account; G2 passed; first production posts published.
- **Acceptance checks**: smoke report; idempotency drill (one post only); `publish_attempts` audit trail; permalinks open.

### M6 · Analytics
- **Scope**: M6-01 … M6-07, M6-09 (P0); M6-08 (P1).
- **Definition of Done**
  - Media snapshots at H2/D1/D3/D7/D28 and daily account snapshots are collected automatically; failures are visible.
  - Growth, Engagement, Content learning and Operations dashboards work with market and date filters.
  - The lineage view answers the §5 question for any published post.
- **Acceptance checks**: after 7 days of posting, D7 snapshots exist for every post; the content-learning table lists the posts under the right dimensions.

### M7 · Learning (P1)
- **Scope**: M7-01 … M7-06.
- **Definition of Done**: weekly performance summaries per market; idea generator v2 and writer v2 use them (eval shows no regression); overuse filter; experiments-lite with arm results.
- **Acceptance checks**: an idea batch cites the summary in `whyNow`; `master_ideas.performance_summary_id` is set; an experiment shows "insufficient data" until both arms reach the minimum.

### H · Hardening and MVP acceptance
- **Scope**: H-01 … H-04 (P0); H-05, H-06 (P1).
- **Definition of Done**: Health page with indicators (12 §12.9); security review done (RLS anon check, headers, secrets inventory, key rotation script); runbooks written; acceptance run against 13 §13.8 signed off by Ihor and Sergey.

## 14.3 Quality gates

### G1 · Content quality proof (end of M2)
**Input**: ≥ 2 real sources; ≥ 30 approved cards; 10 Master Ideas × 2 markets = 20 text variants.

| # | Criterion | Pass condition |
|---|---|---|
| 1 | Grounding [S§18] | 0 unsupported chef claims in variants judged approvable (critic + human check); 100 % of factual slides cite approved cards; 0 numeric mismatches after the pipeline |
| 2 | Localization [S§18] | Native reviewers (es-ES, EN) average ≥ 4.0 / 5 on "reads as if written for my market"; no variant below 3 |
| 3 | Cross-market originality [S§18] | 0 differentiation FAIL after the pipeline; reviewers judge ≥ 90 % of pairs "not a translation of each other" |
| 4 | Voice and usefulness [S§18] | ≥ 70 % of variants approvable with ≤ 3 field edits (Ihor / Sergey) |
| 5 | Operations | One idea → 2 variants in ≤ 10 min; text cost per idea recorded (target ≤ $2) |

- **If it fails**: a time-boxed improvement loop of 1–2 weeks (prompts, knowledge cleanup, market notes, voice examples, differentiation thresholds), then re-run on a fresh set. If it still fails, decide on scope (for example: start with one market) before M3.
- **Owners**: Ihor + Sergey. Record: `docs/decisions/G1.md`.

### G2 · Go-live publishing (end of M5)
1. Live smoke test passed on a test account; idempotency drill passed (exactly one post).
2. Dry run passed on both production accounts with a real approved carousel.
3. Kill switch tested; environment allowlist verified; token refresh run manually and passed.
4. Legal/compliance items closed (B-13): AI imagery disclosure policy, privacy policy URL, food-safety claims policy.
5. ManyChat flows ready for the planned commercial CTAs (or first posts are non-commercial).
6. Sergey approved the first 3 posts per market.
Record: `docs/decisions/G2.md`.

## 14.4 Track B — non-engineering dependencies (start now)

| ID | Item | Owner (proposed) | Needed by | Blocks |
|---|---|---|---|---|
| B-01 | Decide repository visibility (make it private before adding the spec or any Reg.Chef content) | Ihor | now | pushing plan/spec (R-17) |
| B-02 | Cloud accounts + billing: Vercel, Supabase (EU), Cloudflare R2, Trigger.dev, Sentry | Ihor | M0 week 1 | M0-09 … M0-19 |
| B-03 | AI vendor accounts and keys (Anthropic, OpenAI); check data-use / retention terms against the partnership's rules | Ihor | S-01 / M1 | S-01, M1-08+ |
| B-04 | Rights matrix per source class [S§6.2] (use, translate, adapt, visually transform, sell, AI processing, prompt improvement) | Ihor + Sergey | M1 start | real ingestion |
| B-05 | 2–3 priority books/guides as files | Sergey | S-01 / M1 | S-01, M1-25 |
| B-06 | 50–100 historical posts with metrics and annotations [S§20] | Sergey / Ihor | M1-22 | P1 features, exemplars |
| B-07 | Product list; which products get ES/EN offers; landing pages | Ihor | M2-02 (list), M4-11 (landing) | commercial CTAs |
| B-08 | English brand voice guide + ES/EN market tone notes; taxonomy review; Sergey's example edits | Sergey + native reviewers | M2-09 | content quality |
| B-09 | Native reviewers for es-ES and EN (part-time) | Ihor | G1 | G1, ongoing review |
| B-10 | Brand assets: logo (SVG), fonts with web-embedding license, palette, visual references | Sergey / designer | M3-06 | rendering |
| B-11 | Meta: developer apps (dev/prod), Instagram Professional accounts for ES, EN and tests, roles, redirect URIs | Ihor | start week 1; needed M5 | M5 |
| B-12 | ManyChat accounts and keyword flows per Instagram account | Ihor | M4-11 / G2 | commercial CTAs |
| B-13 | Legal / compliance: AI-generated imagery disclosure (Meta policy; EU AI Act transparency rules — check applicability and dates), food-safety claims per market, privacy policy page, data-deletion text | Ihor + counsel | before G2 | first public post |
| B-14 | Claude Code cloud environment: allow docs domains (`developers.facebook.com`, `trigger.dev`, vendor docs) in Network access; dev-only secrets | Ihor | M0 | VERIFY tasks in cloud sessions |

## 14.5 Scope: MVP-critical vs post-MVP [S§23 item 16]

| Area | P0 — MVP-critical | P1 — MVP-complete | P2 — post-MVP |
|---|---|---|---|
| Sources & knowledge | PDF/DOCX/TXT/MD/SRT/VTT upload, rights gate, pages, extraction, verification, review, versions, dedupe, retrieval | historical posts import + annotation, source chunk search, scanned-page transcription, English gloss, manual cards, merge | video/audio transcription, external research workflow |
| Content | AI + manual ideas, ES/EN pipeline, validators, numeric fidelity, differentiation, critic loop, evals | voice examples / few-shot v1 | France, several accounts per market |
| Visuals | templates A, B, E, F; renderer + QA; image adapter; preview; visual regression; bake-off | templates C, D; photo library; visual QA with vision; contrast check | 3:4 export, Reels |
| Review & calendar | field edit/regenerate, approve/reject, snapshots, drafts list, scheduling, calendar, campaign IDs, ManyChat checklist | keyboard shortcuts, drag & drop | "clone as new variant", best-time suggestions |
| Instagram | OAuth, token refresh, callbacks, publish machine, dry run, kill switch, guards, smoke test | AI imagery disclosure (if not required by law) | comment webhooks, Stories, single image posts |
| Analytics | snapshots, account metrics, Growth/Engagement/Content learning/Operations, lineage | commercial dashboard, attribution import | sales webhooks, ManyChat API |
| Learning | – | performance memory, generation v2, overuse filter, experiments-lite | automatic allocation, prompt config UI, eval set builder from review events |
| Operations | Sentry, health page, security review, runbooks | dependency rules, cost alert, uptime monitor, gitleaks | cleanup job, log drain |

## 14.6 Critical path

```
M0-01 → M0-09 → M0-10 → M0-12 → M0-14 ─┐
                                        ├→ M1-01 → M1-10 → M1-12 → M1-13 → M1-15 → M1-18 → M1-19
M1-08 ─────────────────────────────────┘                                                   │
M2-03, M2-04 (any time after M0-01) ──────────────────────────────────────────────────────┐ │
                                   M2-06 → M2-09 → M2-10 → M2-12 → M2-13 → M2-14 → M2-15 ←┘─┘ → G1
G1 → M3-07 → M3-08 → M3-11 → M3-12 → M4-03 → M4-05 → M4-06 → M4-08 → M5-06 → M5-07 → G2 → M6-03 → M6-09 → H-04
Parallel: Track B · S-01 · M3-06/M3-07 (templates) during M2 · M5-00…M5-05 during M3/M4 (second engineer)
```

## 14.7 Definition of Done for every task
1. Business logic lives in `@rc/modules`; server actions and jobs stay thin (03 §3.3).
2. Tests added or updated; `pnpm check` is green; E2E / visual tests updated when behavior or templates change.
3. Migrations generated, reviewed and applied in tests; `.env.example` updated for new variables.
4. Status changes use the transition helper and write audit events.
5. No secrets, tokens, presigned URLs or Reg.Chef IP in logs, fixtures or git.
6. UI tasks: loading, empty and error states; screenshots in the PR.
7. Plan kept current: checkbox ticked in `15-task-list.md`; deviations and verification results in `decision-log.md`.
