# RegChef International Content Engine — MVP v0.1 implementation plan

Status: draft for review · Date: 2026-09-27 · Source of truth: *International Content Engine — Product & Technical Specification for MVP Implementation Planning*, v0.1 (27 Sep 2026), §23. Local copy: `docs/spec/RegChef_International_Content_Engine_MVP_Spec_v2.md` (git-ignored while the repository is public).

This plan follows spec §23. Files 01–17 map one-to-one to the output format required in §23.1.

## Contents

| # | File | Answers |
|---|---|---|
| 1 | [01-architecture-decisions.md](01-architecture-decisions.md) | Stack, key libraries, deployment topology, trade-offs (ADR) |
| 2 | [02-system-components.md](02-system-components.md) | System diagram, component responsibilities, main runtime flows |
| 3 | [03-repository-structure.md](03-repository-structure.md) | Folder tree, packages, conventions |
| 4 | [04-database-schema.md](04-database-schema.md) | Tables, keys, enums, indexes, JSON shapes, migrations, spec deltas |
| 5 | [05-api-contracts.md](05-api-contracts.md) | Server actions, queries, route handlers, request/response contracts |
| 6 | [06-background-jobs.md](06-background-jobs.md) | Jobs, triggers, retries, idempotency, failure handling, cron |
| 7 | [07-ai-prompts-rag.md](07-ai-prompts-rag.md) | Ingestion + Knowledge Card extraction, providers, prompts, schemas, grounding, critic loop, versioning, evals |
| 8 | [08-visual-rendering.md](08-visual-rendering.md) | Templates, typography, images, preview, render QA, export |
| 9 | [09-instagram-integration.md](09-instagram-integration.md) | Auth, tokens, publish state machine, insights, callbacks, limits |
| 10 | [10-frontend-screens.md](10-frontend-screens.md) | Screens, review UX, state machines, permissions |
| 11 | [11-analytics-learning.md](11-analytics-learning.md) | Snapshots, views, dashboards, performance memory, experiments, attribution |
| 12 | [12-security-observability.md](12-security-observability.md) | Secrets, tokens, source IP, audit, safe logging, health indicators |
| 13 | [13-testing-strategy.md](13-testing-strategy.md) | Unit, integration, E2E, evals, rendering regression, Instagram test strategy, acceptance mapping |
| 14 | [14-milestones.md](14-milestones.md) | Milestones with DoD, gates G1/G2, Track B dependencies, MVP vs post-MVP |
| 15 | [15-task-list.md](15-task-list.md) | 127 dependency-ordered tasks with checkboxes (106 P0), area → task map, build sequence by folder |
| 16 | [16-risks-assumptions.md](16-risks-assumptions.md) | Risks, assumptions, spec corrections, verification list, open questions |
| 17 | [17-first-coding-task.md](17-first-coding-task.md) | Where to start, first two weeks, copy-paste prompts |
| – | [decision-log.md](decision-log.md) | Deviations, verification results, gate outcomes |

## Legend (fact vs decision)
- **[S§7.2]** — taken from the spec, section 7.2.
- **D-xx** — a decision made in this plan (01). **(material)** = confirm before M0 ends.
- **A-xx** — an assumption; **C-xx** — a correction to the spec; **R-xx** — a risk; **Q-xx** — an open question (16).
- **⚠ V-xx** — verify against current official docs before the named task (16 §16.4).
- **B-xx** — non-engineering dependency (Track B, 14 §14.4).
- Priority: **P0** MVP-critical (acceptance path) · **P1** MVP-complete · **P2** post-MVP.

## Plan at a glance
- **Shape**: modular monolith in one pnpm workspace — Next.js on Vercel, Trigger.dev workers, Supabase Postgres + pgvector, Cloudflare R2. TypeScript everywhere.
- **AI**: Claude (`claude-opus-5-5`) behind a provider interface; OpenAI for embeddings and the first image adapter. Every call has a Zod schema, deterministic validators, one repair, and is logged with cost. Generation is closed-book on approved Knowledge Cards; a critic loop plus human approval guard quality.
- **Rendering**: AI makes images; HTML/CSS templates rendered by Chromium make the final 1080×1350 slides, with QA for overflow, glyphs and logo placement.
- **Publishing**: official Instagram API (Instagram Login); approval snapshots, safeguards, idempotency and reconciliation prevent wrong or duplicate posts; kill switch and dry runs.
- **Order**: M0 Foundation → M1 Knowledge → M2 Content → **G1 quality gate** → M3 Creative → M4 Review + Calendar → M5 Instagram → **G2 go-live gate** → M6 Analytics → M7 Learning (P1) → Hardening + MVP sign-off. Rough effort: 12–16 weeks for one engineer with Claude Code (14 §14.1).

## Before coding starts (owner actions)
1. **Make the repository private** (B-01, R-17) — it is public now, and the spec is an internal document.
2. Confirm the material decisions (16 §16.5) or change them.
3. Start Track B items with long lead times: Meta apps and Instagram accounts (B-11), rights matrix (B-04), native reviewers (B-09), brand assets and fonts (B-10).
4. Allow the docs domains in the Claude Code cloud environment (B-14).

## Execution protocol (Claude Code)
1. Pick the next unchecked task in `15-task-list.md` whose dependencies are done (or the task you are given).
2. Read `CLAUDE.md`, the task entry, and every section in its **Refs**. Verify ⚠ items first.
3. Implement inside the task scope; add follow-up tasks instead of widening scope.
4. Meet the Definition of Done (14 §14.7), run `pnpm check`, tick the box, log deviations in `decision-log.md`.
5. Commit `type(scope): summary [TASK-ID]`; one PR per task.
