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
- Impact on plan: the manual `pnpm db:migrate` run against dev Supabase is pending (owner); M0-09 is ticked after it.

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
