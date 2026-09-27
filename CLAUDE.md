# CLAUDE.md — RegChef International Content Engine

Internal tool that turns Reg.Chef's Russian-language culinary IP into original Spanish (es-ES) and English Instagram carousels: Source → Knowledge → Master Idea → local variants → visuals → QA → human approval → Instagram → analytics → learning.

## Sources of truth
- Implementation plan: `docs/plan/` (start with `docs/plan/README.md`). Task list with checkboxes: `docs/plan/15-task-list.md`.
- Product spec v0.1: `docs/spec/RegChef_International_Content_Engine_MVP_Spec_v2.md` (Markdown copy of the `.docx`). `docs/spec/.gitignore` keeps it out of git while the GitHub repository is public — never force-add it.
- Deviations and verification results: `docs/plan/decision-log.md`.

## How to work on a task
1. Take the task you are given (or the first unchecked one whose dependencies are done).
2. Read the task entry and every section in its **Refs** before coding. Items marked ⚠ V-xx must be verified against current official docs first; record the result in the decision log.
3. Stay inside the task scope. Missing work → add a follow-up task (e.g. `M1-07a`) instead of widening the PR.
4. Definition of Done: `docs/plan/14-milestones.md` §14.7. Tick the checkbox in the same commit.
5. Commit message: `type(scope): summary [TASK-ID]`.

## Architecture rules
- Modular monolith (pnpm workspace): `apps/web` (Next.js), `jobs` (Trigger.dev), `modules` (domain services), `db`, `lib`, `prompts`, `templates`, `evals`.
- Business logic only in `@rc/modules`. Server actions and Trigger.dev tasks are thin: validate → call one service → map errors.
- Services take a `ServiceContext` (db, logger, clock, actor, storage, providers, jobs). No `process.env` outside `@rc/lib/env`.
- Status changes go through the transition helper and write `audit_events`.
- AI calls go through `runStage()`; never call a vendor SDK from business code. Prompt versions are immutable (`vN.ts`); change = new version + eval.
- Default model `claude-opus-5`; no `temperature`. Load the `claude-api` skill before touching the Anthropic adapter.
- Instagram specifics live only in `modules/instagram`. Never publish content that is not APPROVED; never retry `media_publish` blindly.

## Safety rules
- Never log or persist tokens, OAuth codes, API keys or full presigned URLs. Use the redaction helpers.
- No Reg.Chef intellectual property, real outputs or secrets in git. Fixtures are synthetic. `spikes/**/out` and `evals/results` are git-ignored.
- Tests must not call paid APIs or Meta. Use fakes and MSW.
- In cloud sessions use the pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH`); never run `playwright install`.

## Commands
Node 24 (`.nvmrc`), pnpm version from `packageManager`. In cloud sessions the SessionStart hook (`scripts/claude/session-start.sh`) installs dependencies; locally run `pnpm install`.

| Command | What it does |
|---|---|
| `pnpm install` | Install (CI and cloud: `--frozen-lockfile`) |
| `pnpm check` | Biome + typecheck + all tests. Run before every commit. |
| `pnpm test` | Vitest, all packages (`pnpm --filter @rc/<pkg> test` for one) |
| `pnpm typecheck` | `tsc` in every package |
| `pnpm lint` / `pnpm format` | Biome lint / format with write |
| `pnpm dev` | Next.js dev server (`apps/web`) on :3000 |
| `pnpm build` | Production build of `apps/web` |

Added by later tasks (not available yet): `pnpm db:generate` · `db:migrate` (M0-09), `pnpm db:seed` (M0-11), `pnpm jobs:dev` (M0-14), `pnpm rc <command>` (M0-21), `pnpm test:e2e` (M1-25), `pnpm test:visual` (M3-14), `pnpm eval` (M2-16). Update this table when you add one.
