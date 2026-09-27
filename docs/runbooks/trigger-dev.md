# Trigger.dev: project, local dev, alerts

Plan: 01 D-05, 06 §6.1, §6.5. Verified against Trigger.dev docs on 2026-09-27 (V-17, SDK 4.6.4).

## Project
1. Create an organization and a project `regchef` at https://cloud.trigger.dev (EU region if offered; ⚠ V-17 regions).
2. Copy the project ref (`proj_…`) → `TRIGGER_PROJECT_REF` in `.env`.
3. API keys → **dev** secret key → `TRIGGER_SECRET_KEY` in `.env`; set `JOBS_MODE=trigger` to use it. Prod/staging keys go to Vercel only.
4. In the Trigger.dev dashboard, environment variables for **dev/staging/prod**: the server variables from `.env.example` (DB, AI, R2, Instagram, security, `APP_ENV`, `JOBS_MODE=trigger`, `TRIGGER_SECRET_KEY` of the same environment so jobs can start jobs).

## Local dev
```bash
pnpm --filter @rc/jobs exec trigger login   # once per machine
pnpm jobs:dev                               # dev worker; reads ../.env
pnpm jobs:hello Reg.Chef                    # in another terminal
```
Expected: the run appears in the dashboard (dev environment) as `hello`, and `audit_events` gets a row with `action = 'job.hello'`, `actor_type = 'JOB'`, `job_run_id = <run id>`.

- Tasks validate the full server environment, so `.env` needs every required variable (including the security block), not only the Trigger.dev ones. Otherwise runs fail with `EnvValidationError` and retry 3 times.
- The worker reads `.env` once at start: restart `pnpm jobs:dev` after changing it.
- `jobs:hello` needs `JOBS_MODE=trigger`; to keep `inline` in `.env`, run `JOBS_MODE=trigger pnpm jobs:hello`.
- Run the commands from the repository root. The esbuild warning `Unrecognized target environment "ES2024"` from the CLI is harmless.

Without Trigger.dev, `JOBS_MODE=inline` runs the same handlers in-process (`createInlineJobRunner`).

## How jobs are wired
- Handler registry: `modules/src/job-handlers.ts` (name → Zod payload + handler). Tasks in `jobs/src/tasks/*` are one line: `handlerTask("<name>", { queue })`.
- Payload on the wire: `{ payload, meta: { requestId } }`.
- Idempotency keys are always created with `idempotencyKeys.create(key, { scope: "global" })`. Raw strings default to **run** scope since v4.3.1. Keys live 30 days; a failed run's key is cleared, so re-triggering a failed job creates a new run.
- Errors: `TransientError` and unknown errors are rethrown (retry: 3 attempts, factor 2, 5 s – 5 min, randomized). Other `AppError`s become `AbortTaskRunError` (no retry).
- Queues (`jobs/src/queues.ts`): llm 4, images 3, render 2, instagram-publish 1 (per `concurrencyKey = socialAccountId`), instagram-read 2, default 5.
- Machines: default `small-1x` (0.5 vCPU, 0.5 GB); `medium-1x` (1 vCPU, 2 GB) for render-carousel and ingest-source.

## Alert channel (plan 06 §6.1)
Project → **Alerts** → New alert:
- Channel: **Email** to the owners (or a Slack channel via the Slack integration).
- Events: **task run failed** in **prod** (and staging).
- Tasks to watch: `publish-content`, `ingest-source`, `refresh-instagram-tokens`, `collect-insights` (add them as they are created).
- Also enable **deployment failed** alerts for prod.
Record the configured channel in `decision-log.md` when prod is set up (H-03).
