# End-to-end tests (Playwright)

Plan 13 §13.4. Spec 1 (add a source → cards appear → edit → approve as the chef) is in `apps/web/e2e/knowledge.e2e.ts`, spec 2 (generate ideas → accept one; write one by hand → reject it) in `apps/web/e2e/ideas.e2e.ts`; the other specs arrive with their features (M2, M4, M5).

## Run

```bash
pnpm e2e        # builds the app, starts it on port 3100 and runs the specs
```

or, with an existing build: `pnpm --filter @rc/web e2e`. Locally the installed Google Chrome is used (no browser download); with `CI=1` Playwright's own Chromium is expected (`pnpm exec playwright install chromium`).

To read the server's log while a test runs, start it yourself and let Playwright reuse it:

```bash
cd apps/web
APP_ENV=development AI_PROVIDER=fake STORAGE_PROVIDER=memory JOBS_MODE=inline \
  E2E_TEST_AUTH_SECRET=e2e-only-secret-never-used-anywhere-else-0123456789 pnpm exec next start --port 3100
E2E_REUSE_SERVER=1 pnpm exec playwright test
```

## What it uses

- The production build with fakes: `AI_PROVIDER=fake` with a scripted model (`modules/src/ai/e2e-llm.ts`, used only when `E2E_TEST_AUTH_SECRET` is set, which production refuses), `STORAGE_PROVIDER=memory`, `JOBS_MODE=inline`. The values are set by `playwright.config.ts`, not by `.env`, so a `.env` with `AI_PROVIDER=live` is never used by the tests.
- The database and Supabase Auth of `.env` (a dev project). The test signs in through `/auth/test-login` as `e2e-chef@regchef.test`, an active chef that the test creates if it is missing, and removes the source, cards, versions, batches and model runs it created (titles start with `E2E source`). The user and the audit events stay.
- Spec 2 seeds a source with two approved cards straight into the database (`seedApprovedCards`, titles start with `E2E source` / `E2E card`) and removes them, the ideas made from them and those ideas' model runs afterwards. The scripted model answers `idea-generator` with one idea built on the first `E2E card`.
- In spec 1 the source is added as pasted text: with memory storage a presigned browser upload has no bucket to go to.
- Timeouts are generous (the job waits up to two minutes): every database round trip counts on a slow network.

## Not in CI yet

The specs need a Supabase project for the test login (service role key) and a database, so they run on a developer machine. Putting them into CI needs a dedicated test project and its secrets (task B-02) and a Postgres service container; until then `pnpm check` and the CI jobs do not run them.

## What this caught

The first run found that a production build with `JOBS_MODE=inline` could not read uploaded files: `file-type` imports `strtok3`, which Next left external and could not resolve from the app. `strtok3` and `token-types` are now dependencies of `@rc/web`.
