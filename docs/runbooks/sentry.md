# Sentry: projects, variables, checks

Plan: 12 §12.7 (safe logging), §12.9 (observability). SDKs: `@sentry/nextjs` 11 (web), `@sentry/node` 11 (jobs).

## Projects
- Organisation in the **EU region** (data residency, 12 §12.8).
- Projects `regchef-web` (Next.js) and `regchef-jobs` (Node). One DSN per project; environments are set by the SDK (`APP_ENV`).
- Alerts: new issue in `production` → email to owners.

## Variables
| Variable | Where | Purpose |
|---|---|---|
| `SENTRY_DSN` | Vercel, Trigger.dev, `.env` | Server-side web (web project DSN) and jobs (jobs project DSN) |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Vercel (build), `.env` | Browser errors (web DSN) |
| `APP_RELEASE` | Trigger.dev, CI | Release = git SHA. On Vercel `VERCEL_GIT_COMMIT_SHA` is used automatically |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_PROJECT_JOBS` | Vercel build, CI for `trigger deploy` | Source map upload only; builds without the token skip it |

No DSN → Sentry is off (local dev and PR CI work without it).

## What is sent
- Server: errors from server components, route handlers and server actions (`onRequestError`), and unexpected errors in actions (`runAction`, tags `action`, `request_id`).
- Browser: client errors (`instrumentation-client.ts`).
- Jobs: the final failure of a run after all retries (`tasks.onFailure`), tags `task_id`, `run_id`, `request_id`. Payloads are not sent.
- Every event goes through `scrubSentryEvent` (tokens, OAuth codes, `X-Amz-*`, URL passwords, cookies, auth headers removed; user id only; `x-request-id` → tag `request_id`). `dataCollection` is minimal (no user info, cookies, bodies, DB query data, stack variables, gen-AI inputs/outputs).
- Tracing is off (`tracesSampleRate: 0`).

## Request ids
`proxy.ts` keeps a well-formed incoming `x-request-id` or creates a UUID, forwards it to the app and returns it on every response. It flows into `ServiceContext.requestId`, job envelopes (`meta.requestId`), logs, `audit_events.request_id` and Sentry tags. The UI shows it in error toasts.

## Manual check (M0-19 Done when)
With the DSNs in `.env`:
1. Web: `pnpm build && pnpm --filter @rc/web start`, sign in, open `/api/dev/sentry-test` (development only) → 500. In Sentry: an issue "Sentry test (M0-19)…" with tag `request_id` equal to the response's `x-request-id`, message showing `access_token=[REDACTED]`, no `cookie` / `authorization` headers, user = id only.
2. Jobs: `pnpm jobs:dev`, then `pnpm jobs:hello --fail` → after the retries the run fails; in the jobs project: "hello failed on purpose (M0-19)…" with `task_id=hello`, `run_id`, and `access_token=[REDACTED]`.
Record the result in `docs/plan/decision-log.md`.
