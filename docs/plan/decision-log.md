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

## 2026-09-28 · Brand and market settings [M0-18]
- Context: M0-18 (05 §5.2): brand and market editors; actions `updateBrand`, `updateMarket`, `upsertTaxonomyTerm`, `setAppSetting` with audit.
- Decision:
  - New module subpath `@rc/modules/settings` (brand, taxonomy, app settings): 02 §2.2 has no owner for these tables, and `core` stays infrastructure. The market profile service lives in `@rc/modules/localization` (02 §2.2).
  - `updateBrand` (owner): `visualSystem` validated with `VisualSystem`; errors come back as `visualSystem.<path>`; audit `brand.updated` with the changed field names.
  - `updateMarket` (owner, editor): Zod for all fields; `ForbiddenPatternList` compiles REGEX patterns (`iu`) so an invalid regex rejects the whole save with `forbiddenPatterns.<i>.pattern`; time zones checked with `Intl.DateTimeFormat`; only owners may change `isActive` (`ForbiddenError`); audit `market.updated` with changed field names only; no write and no audit when nothing changed.
  - `upsertTaxonomyTerm` (owner): code `UPPER_SNAKE_CASE`; upsert on `(kind, code)`; no delete (deactivate instead); audit `settings.changed` with `termCode` — a `code` key would be redacted by the audit/log scrubber (M0-05).
  - `setAppSetting` (owner): allowed keys `publishing.enabled`, `publishing.min_gap_minutes` (0–1440), `analytics.min_sample` (1–1000), `rights.defaults` (`RightsDefaults`); `updated_by` = actor; audit `settings.changed` with from/to (rights defaults: key only). No UI yet: the kill switch UI is H-01 (`/settings/health`), rights defaults with M1.
  - UI: `/settings/brand` (brand form with Markdown voice guide, visual system JSON editor with parse errors and server field errors, taxonomy tabs with inline label edit, (de)activate, add term); `/markets/[code]` (general, tone and food culture, vocabulary / forbidden patterns (client regex check) / visual hypotheses row editors, sticky save bar). Read-only for roles that cannot edit.
  - Toasts moved to the top centre: at the default bottom-right an error toast covered the sticky save button, and a second save click never reached the form (found in the live check).
- Evidence / links: `modules/src/settings/settings.test.ts`, `modules/src/localization/update-market.test.ts` (edits persist with audit rows; invalid regex rejected with a field path and nothing saved). Live check against dev Supabase (one-off E2E test-login): invalid regex refused by client and server; valid save stored tone notes + pattern with a `market.updated` audit row (actor USER, request id, `fields`), then reverted through the UI; invalid visual system refused with `colors.accent` / `logo.minHeightPx` messages and nothing written.
- Impact on plan: none.

## 2026-09-28 · App shell and navigation [M0-17]
- Context: M0-17 (10 §10.1 navigation, 10 §10.2 screen catalog).
- Decision:
  - One screen catalog (`apps/web/src/components/shell/screens.ts`: route, title, purpose, building task, P1 flag) drives the sidebar and every placeholder page; a test checks that each catalog route has a `page.tsx`.
  - Sidebar per 10 §10.1. **Markets come from the database** (`@rc/modules/localization` `listMarkets`, sidebar order); inactive markets (fr-FR) are shown disabled with "later". P1 screens carry a "P1" note.
  - `/` redirects to `/dashboard` (10 §10.2). Placeholder pages for all 21 catalog routes, including dynamic ones (`/content/ideas/[id]`, `/content/review/[ideaId]`, `/content/published/[publicationId]`, `/knowledge/sources/[id]`, `/knowledge/cards/[id]`, `/markets/[marketCode]`); unknown market codes → 404.
  - User menu (Base UI dropdown): email, role, sign out (POST `/auth/sign-out`). Mobile: the sidebar moves into a left sheet that closes on navigation.
  - Banner slot `Banners` with typed banners (`info | warning | danger`); sources (kill switch, re-auth, token expiry) are added by M4/M5/H-01, so it renders nothing now.
  - `@rc/db/seed` subpath export (tests of other packages seed with it).
- Evidence / links: `screens.test.ts`, `modules/src/localization/markets.test.ts`. Live run against dev Supabase with a one-off E2E test-login (secret passed on the command line only): all 25 routes → 200 with a session (`/markets/de-DE` → 404), 307 to `/login` without; sidebar, active item, disabled France, user menu, mobile sheet and sign-out checked in the browser at 1280×800 and 375×812; no console errors.
- Impact on plan: none.

## 2026-09-27 · Dev Supabase project stays in London (eu-west-2) [B-02]
- Context: D-03 and `docs/runbooks/supabase.md` specify EU Central (Frankfurt). The dev project (`udvisikrshcnbjddgrsr`) was created in `eu-west-2` (London); Supabase cannot move a project between regions.
- Decision: keep the dev project in London. It holds no real user data; the UK has a GDPR adequacy decision. The **prod** project is still created in Frankfurt.
- Evidence / links: pooler host `aws-0-eu-west-2.pooler.supabase.com`; both connection strings and Supabase Auth checked from the owner's machine on 2026-09-27; migrations `0000`–`0001` already applied.
- Impact on plan: `docs/runbooks/supabase.md` (Projects) notes the dev region. D-03 unchanged for production.

## 2026-09-27 · Authentication design; V-20 auth part [M0-15]
- Context: M0-15 (01 D-07, 12 §12.5). V-20 still had the Auth part open.
- V-20 (Supabase docs, 2026-09-27): server code must verify sessions with `getClaims()` (verifies the JWT) or `getUser()`, never trust `getSession()`; the proxy refreshes cookies with `getClaims()`. SSR magic links use the email template `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` and `verifyOtp` on the server. Default mailer: one link per address per 60 s, links expire after 1 h → custom SMTP for production. Supabase now names the public key "publishable key"; the anon key still works.
- Decision:
  - Supabase is used **server-side only** (`@supabase/ssr` 0.12.7 server client, `proxy.ts`, route handlers, server actions). No browser client, so no `NEXT_PUBLIC_*` variables; `SUPABASE_ANON_KEY` holds the anon or publishable key.
  - Allowlist logic in `@rc/modules/core/users.ts`: `resolveAppUser` (by `auth_user_id`, else link by case-insensitive email on first login with audit `user.linked`; refuse `unknown`, `inactive`, `email_linked_to_other_account`), `isEmailAllowed`, `requireRole` (`ForbiddenError`).
  - Web: `src/proxy.ts` (session refresh; no session → `/login?next=…` for pages, 401 for `/api/*`; public: `/login`, `/auth/*`, `/api/health`, `/api/meta/*`), `requireUser()` / `requireAppRole()` (allowlist re-checked per request; refused sessions are signed out with a message), `/login` (server action; always answers "sent"; `signInWithOtp({ shouldCreateUser: false })` only for allowlisted active emails), `/auth/confirm` (`verifyOtp`, safe `next`), `/auth/sign-out`, `/auth/test-login` (404 unless non-production and the exact `E2E_TEST_AUTH_SECRET`; uses the service role to generate a link). `src/server/context.ts` builds a `ServiceContext` per request (request id from `x-request-id` or random; jobs via Trigger.dev or inline background runner).
  - Users are created by the owner in Supabase (sign-ups off); runbook updated.
  - `(app)` routes are `force-dynamic`; the placeholder dashboard moved to `(app)/page.tsx`.
  - Tests got slow as PGlite tests grew (initdb ~1.4 s per database; ~60 s total, hook timeouts in parallel). `createTestDb()` now starts every database from a migrated template dump cached in the OS temp dir by migration hash (~0.3 s each; full run ~30 s cold, ~12 s warm). Root Vitest config sets `hookTimeout 60 s`, `testTimeout 30 s` for all projects (`extends: true`).
- Evidence / links: https://supabase.com/docs/guides/auth/server-side/nextjs, https://supabase.com/docs/guides/auth/auth-email-passwordless. Tests: `modules/src/core/users.test.ts`, `apps/web/src/server/auth/rules.test.ts`. Smoke run of `next start` with synthetic env: `/` → 307 `/login`, deep link keeps `next`, `/api/preview/slide` → 401, `/auth/confirm` without token → `/login?error=link_invalid`, test-login with a wrong secret → 404.
- Impact on plan: pending manual check with the dev Supabase project (allowlisted email logs in; unknown email refused); M0-15 is ticked after it.

## 2026-09-27 · V-17 verified; job runner and Trigger.dev setup [M0-14]
- Context: M0-14 needs V-17 (Trigger.dev version, idempotency scopes and TTL, failed-run behaviour, machines).
- V-17 results (Trigger.dev docs, 2026-09-27): SDK/CLI **4.6.4**; `runtime: "node-24"` available. `idempotencyKeys.create(key, { scope })` with `run` (default, also for raw strings since v4.3.1), `attempt`, `global`; TTL default 30 days (`idempotencyKeyTTL`). A **failed** run's key is cleared (re-trigger → new run); succeeded/canceled runs keep it. Outside a task all scopes act global. Machines: `small-1x` 0.5 vCPU/0.5 GB (default), `medium-1x` 1 vCPU/2 GB. `AbortTaskRunError` stops retries. Queues are defined in code with `queue({ name, concurrencyLimit })`; `concurrencyKey` at trigger time. Backend triggering: `tasks.trigger(id, payload, { idempotencyKey, delay, tags, concurrencyKey })` with `TRIGGER_SECRET_KEY`. Remaining V-17 items (Playwright extension, `wait.for`, `batchTriggerAndWait`, regions) belong to M3-12 and later.
- Decision:
  - `@rc/modules/core/job-runner`: `defineJob`, `JobRunner`, `runJobHandler` (Zod payload validation → `ValidationError`), `triggerJob(ctx, …)` (adds `requestId`), `createInlineJobRunner` (await/background, Trigger.dev-like idempotency, `getRun`), `createTriggerDevJobRunner` (global-scope keys prefixed with the job name, `delay` in seconds), `disabledJobRunner` (default in contexts). `ServiceContext` gained `jobs`.
  - Registry `modules/src/job-handlers.ts`; core learns names and payload types through declaration merging (`interface JobRegistry`), which avoids a core → handlers → modules cycle.
  - Wire format `{ payload, meta: { requestId } }`.
  - `jobs/`: `trigger.config.ts` (project ref from `TRIGGER_PROJECT_REF`, dirs `src/tasks`, node-24, small-1x, maxDuration 900 s, retry defaults from 06 §6.1, empty build extensions), `queues.ts`, `handlerTask()` (task id = job name; non-retryable errors → `AbortTaskRunError` with a scrubbed message), `hello` task, `pnpm jobs:dev`, `pnpm jobs:hello`.
  - **Deviation:** the dev-only button from the M0-14 "Done when" needs auth (M0-15) and actions (M0-16); `pnpm jobs:hello` triggers the same path from the CLI instead. The button is follow-up task **M0-14a**.
  - pnpm `allowBuilds: "@depot/cli": false` (remote builds for `trigger deploy`; revisit with CI deploys).
  - Runbook `docs/runbooks/trigger-dev.md` (project, local dev, how jobs are wired, alert channel setup).
- Evidence / links: https://trigger.dev/docs/idempotency, https://trigger.dev/docs/config/config-file, https://trigger.dev/docs/queue-concurrency, https://trigger.dev/docs/machines, https://trigger.dev/docs/errors-retrying, https://trigger.dev/docs/triggering. Tests: `modules/src/core/job-runner.test.ts` (inline hello → audit row), `jobs/src/jobs.test.ts`.
- Impact on plan: new task M0-14a. Pending manual check: `pnpm jobs:dev` + `pnpm jobs:hello` against the dev Trigger.dev project; M0-14 is ticked after it.

## 2026-09-27 · V-22 verified; storage provider [M0-13]
- Context: M0-13 needs V-22 (R2 presigned PUT and CORS, single PUT limit, EU jurisdiction, public bucket option).
- V-22 results (Cloudflare docs, 2026-09-27):
  - Presigned URLs support GET, PUT, HEAD, DELETE; expiry 1 s – 7 days; SDK region `auto`. They work only on the S3 API domain, **not on custom domains**.
  - PUT can bind `ContentType` (mismatch → 403). Binding `Content-Length` is not documented; we sign it anyway and the gated live test checks it. `completeSourceUpload` also compares sizes with HEAD.
  - Browser uploads need a bucket CORS policy.
  - Single PUT ≈ 5 GiB; objects up to ≈ 5 TiB.
  - EU jurisdiction is chosen at bucket creation, cannot be changed, and needs the endpoint `https://<account>.eu.r2.cloudflarestorage.com`.
- Decision:
  - `StorageProvider` in `@rc/lib/providers/storage`: `presignPut`, `presignGet`, `head` (null if missing), `getStream` (web ReadableStream), `getBytes`, `put`, `delete` (missing is fine). R2 adapter on `@aws-sdk/client-s3` 3.1141 with `requestChecksumCalculation/responseChecksumValidation: WHEN_REQUIRED` (otherwise presigned PUTs could demand checksum headers). Errors: 404 → `NotFoundError`, 429 / 5xx / network → `TransientError`, others → `PermanentError`; details carry operation, key and status only.
  - New optional env `R2_JURISDICTION` (`eu`).
  - In-memory fake with `memory://` presigned URLs; one contract suite runs on the fake always and on R2 in `r2.live.test.ts` when `R2_LIVE_TEST=1` (Biome allows `process.env` in `*.live.test.ts` only).
  - `storageKeys` for the 08 §8.8 layout; ids must be single path segments. `safeFileName()` keeps the extension and ASCII only, so Russian names become `file.<ext>` (the original name stays in the DB).
  - `PRESIGN_TTL` holds the 12 §12.4 lifetimes.
  - Runbook `docs/runbooks/r2-setup.md`.
- Evidence / links: https://developers.cloudflare.com/r2/api/s3/presigned-urls/, https://developers.cloudflare.com/r2/platform/limits/, https://developers.cloudflare.com/r2/reference/data-location/, https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/.
- Impact on plan: the live R2 check runs once a dev bucket exists (B-02); record the result here.

## 2026-09-27 · Core module design [M0-12]
- Context: 02 §2.2 lists the `ServiceContext` members; 04 §4.7 rule 6 defines the conditional status update.
- Decision:
  - `ServiceContext` = `{ db, logger, clock, actor, requestId }`. `db` is `AnyDatabase` (postgres.js, PGlite or a transaction). Storage (M0-13), job runner (M0-14) and AI providers (M1-08) are added by those tasks, not as placeholders now. `createServiceContext()` binds `requestId`, actor type and user/run id to the logger.
  - `Actor` = `USER {userId, role}` | `SYSTEM` | `JOB {jobRunId}`; `audit()` maps it to `actor_type`, `actor_user_id`, `job_run_id`, takes `occurred_at` from the injected clock and redacts `data`.
  - `transition()` runs in one transaction: `SELECT … FOR UPDATE` (to know the previous status for the error and the audit row), then `UPDATE … WHERE id = $id AND status = ANY($from) RETURNING *`, then an audit event (default action `<table>.status_changed`, data `{ from, to, … }`). Audit is always written, so DoD rule 4 cannot be skipped. Unknown id → `NotFoundError`; wrong status → `InvalidStateError` with `{ from, allowedFrom, to }`.
  - `withTransaction(ctx, fn)` passes a context bound to the transaction; nested calls use savepoints.
  - `@rc/db/orm` and `@rc/db/pg-core` re-export drizzle so every package uses the one drizzle-orm instance that @rc/db resolves with its peers (a second copy would break types and `instanceof`).
- Evidence / links: `modules/src/core/core.test.ts` (PGlite: allowed / refused / not found / rollback / chained transitions, audit rows).
- Impact on plan: none.

## 2026-09-27 · Seed behaviour and default rights [M0-11]
- Context: M0-11 asks for an idempotent seed; the plan does not give default rights values and does not say whether a re-run may overwrite rows.
- Decision:
  - `seedDatabase()` inserts only missing rows (`ON CONFLICT DO NOTHING`) in one transaction and never updates existing ones, so edits made in the app (voice guide, labels, roles, kill switch) survive a re-run. Changing seed data later needs a migration or an in-app edit, not a re-seed.
  - `rights.defaults`: every permission `UNKNOWN` for all 9 source types. The rights gate then blocks AI processing until the owner confirms the matrix (Track B B-04). `RightsPolicy` / `RightsDefaults` Zod schemas and `SOURCE_TYPES` added to `@rc/db/json` now (the `source_type` enum arrives with 0002 and should reuse the list).
  - Markets per A-06 (es-ES and en active, fr-FR inactive); `en` gets the tone note "US spelling, °F first with °C in brackets". Taxonomy per 04 §4.7 with labels derived from codes (e.g. "Myth vs fact"), to be refined with Sergey (B-08).
  - Owners come from `SEED_OWNER_EMAILS` (validated, lower-cased) through `loadSeedEnv()` in `@rc/lib/env`.
- Evidence / links: `db/src/seed/seed.test.ts` (two runs → identical rows; edits survive; A-06 values; rights parse).
- Impact on plan: none. Run `pnpm db:seed` on dev Supabase after merge.

## 2026-09-27 · Core schema details [M0-10]
- Context: 04 §4.3 (0001_core) and §4.4 define the tables and JSON shapes.
- Decision:
  - Drizzle schema in `db/src/schema/core.ts`, migration `0001_core.sql` generated by drizzle-kit and extended by hand with `set_updated_at()` and one `BEFORE UPDATE` trigger per table with `updated_at` (app_users, brands, markets, taxonomy_terms, app_settings). Later migrations add the trigger for their own tables.
  - RLS through Drizzle `.enableRLS()`, so the `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statements live in the generated migration and the snapshot.
  - Constraint names are snake_case (the `auth_user_id` unique constraint is named explicitly; drizzle-kit would use the camelCase key).
  - Foreign keys use the Postgres default (`NO ACTION`), which blocks deletes like `RESTRICT`.
  - `brands.visual_system` keeps the plan's default `{}` and is typed `VisualSystem | {}` ("not configured"); the full `VisualSystem` Zod schema applies on write (M0-18). `themeVariants` defaults to `{}`.
  - `ForbiddenPattern` compiles REGEX patterns with flags `iu` at validation time; PHRASE patterns are not compiled.
  - Zod JSON schemas are exported from `@rc/db/json`.
- Evidence / links: `db/src/schema/core.test.ts`, `db/src/json/core.test.ts`.
- Impact on plan: none. Apply `0001` to dev Supabase with `pnpm db:migrate` after merge.

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
- Manual run (owner, 2026-09-27): `pnpm db:migrate` against dev Supabase through the session pooler → `done`. Read-only check: `vector` 0.8.2 in schema `extensions`, 1 migration recorded, Postgres 17.6.
- Open point: the dev project is in **eu-west-2 (London)**, while 01 D-03 / the runbook say EU Central (Frankfurt) next to Vercel `fra1`. Fine for dev. For prod either create `regchef-prod` in Frankfurt (recommended) or move Vercel to `lhr1`; decide before M5 / G2.
- Impact on plan: none.

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
