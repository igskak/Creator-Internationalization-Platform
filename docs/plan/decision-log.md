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
