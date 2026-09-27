# 12 · Security and observability

Spec §23.1 item 12 (§23 items 12 and 13), based on [S§19].

## 12.1 Threat model (short)

| Asset | Main threats | Controls |
|---|---|---|
| Instagram tokens | leak via logs, client code, DB dump | AES-256-GCM in app code, AAD = account row id, redaction, server-only modules (12.3) |
| Source IP (books, guides) | public URLs, over-broad access, vendor misuse | private bucket, short presigned URLs, auth on every route, rights gate before AI processing, vendor terms check (B-03) |
| Publishing | wrong or duplicate post, post without approval | approval snapshot, safeguards, idempotency, kill switch, env allowlist (09 §9.4.2) |
| Admin access | account takeover, unknown users | magic link + allowlist + roles, no public sign-up, session cookies httpOnly |
| AI pipeline | prompt injection from source or imported text | text in tags treated as data, no model tools, schema validation, human approval |
| Repository | secrets or IP committed (repo may be public) | secret scanning, `.env*` ignored, synthetic fixtures only, spikes/evals outputs ignored |

## 12.2 Secrets [S§19]

| Secret | Used by | Stored in |
|---|---|---|
| `DATABASE_URL` (pooler), `DATABASE_URL_DIRECT` (migrations) | web, jobs / CI migrate | Vercel, Trigger.dev / GitHub Actions (prod migrate job only) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | web (auth only) | Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | admin scripts (invite users) | local / CI only — **never** in the web runtime |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | web, jobs | Vercel, Trigger.dev (token scoped to one bucket) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | jobs (web only in inline dev mode) | Trigger.dev; local `.env` |
| `TRIGGER_SECRET_KEY` / `TRIGGER_ACCESS_TOKEN` | web (trigger) / CI deploy | Vercel / GitHub |
| `IG_APP_ID`, `IG_APP_SECRET`, `IG_REDIRECT_URI`, `META_GRAPH_API_VERSION` | web (OAuth, callbacks), jobs | Vercel, Trigger.dev |
| `TOKEN_ENCRYPTION_KEYS` (`v1:<base64 32 bytes>,v2:…`), `TOKEN_ENCRYPTION_ACTIVE_KEY` | web, jobs | Vercel, Trigger.dev |
| `OAUTH_STATE_SECRET` | web | Vercel |
| `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | web, jobs / CI (source maps) | Vercel, Trigger.dev / GitHub |
| SMTP credentials | Supabase Auth emails | Supabase dashboard |
| `E2E_TEST_AUTH_SECRET` | E2E tests only | CI; the app refuses to start with it in production |

Rules:
- Different values per environment. Claude Code cloud environments get **dev keys only**, never production keys.
- `@rc/lib/env` validates all variables at startup (Zod) and fails fast; secrets are never printed.
- No secret in git: `.env*` ignored (except `.env.example`), GitHub secret scanning on, `gitleaks` in CI (P1).
- Rotation runbook for every secret (H-03). Token encryption keys rotate with `scripts/reencrypt-tokens.ts`.

## 12.3 Instagram tokens and crypto
- AES-256-GCM, random 12-byte IV, 16-byte tag, **AAD = `social_accounts.id`** (a ciphertext copied to another row fails to decrypt). Format `enc:v1:<iv>:<tag>:<ciphertext>` (base64url).
- Decrypt only inside `modules/instagram`, just before the HTTP call. The token is never returned by a server action, never sent to the browser, never stored in logs, audit data, Sentry or `publish_attempts` [S§19].
- OAuth `state`: HMAC-SHA256 over `{marketId, nonce, exp}` + httpOnly cookie; constant-time comparison.
- Meta `signed_request`: HMAC-SHA256 with the app secret, verified before any action.

## 12.4 Source IP and storage [S§19]
- One **private** R2 bucket per environment (EU jurisdiction where available ⚠ V-22). No public listing. API tokens scoped to the bucket.
- Presigned URL lifetimes: upload PUT 15 min (bound content type and length); source download GET 10 min; render previews 30 min; Meta fetch of renders 2 h.
- Only renders are ever made fetchable by Meta. Sources, originals and imports never get long-lived URLs. If presigned URLs fail with Meta (V-14), only the `renders/` prefix moves to a public, unguessable location.
- Bucket CORS: app origins only; methods PUT, GET, HEAD.
- Rights gate: AI processing only when `rights.aiProcessing = ALLOWED`; visual use of library photos only when `visuallyTransform = ALLOWED`; exemplars only when `improvePrompts ≠ DENIED` [S§6.2, §19].

## 12.5 Application hardening
- **AuthN/AuthZ**: every `(app)` route and every server action checks the session and the `app_users` allowlist; roles per 10 §10.6. Route handlers for Meta callbacks rely on `signed_request`, not on sessions.
- **Input validation**: Zod on every action and route; uploads validated twice (declared at presign, magic bytes in the job) [S§19].
- **Headers**: CSP (`default-src 'self'`; images from self, data:, blob:, R2 host; connect to self, Supabase, R2; `frame-ancestors 'none'`), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Slide preview iframe**: `sandbox="allow-scripts"` (no same-origin); content is our template with React-escaped text.
- **CSRF**: server actions use Next.js origin checks; OAuth uses `state`.
- **Test auth bypass** exists only when `E2E_TEST_AUTH_SECRET` is set and the environment is not production; a startup check and a unit test enforce this.
- **Dependencies**: Dependabot/Renovate; `pnpm audit` in CI (warning level).
- **Database**: RLS enabled on all tables without policies (the Supabase REST API exposes nothing); H-02 verifies with the anon key.

## 12.6 Audit log [S§19]
`audit_events` rows are written inside services for at least:
- Sources: `source.uploaded`, `source.processed`, `source.failed`, `source.rights_changed`, `source.archived`.
- Knowledge: `knowledge.approved`, `knowledge.archived`, `knowledge.edited_after_approval`.
- Content: `idea.accepted`, `idea.rejected`, `variant.generated`, `variant.status_changed` (from, to), `variant.approved`, `variant.rejected`, `variant.unapproved`.
- Scheduling and publishing: `publication.scheduled`, `.rescheduled`, `.cancelled`, `.attempt` (step + outcome), `.published`, `.failed`, `.dry_run_passed`.
- Connections: `instagram.connected`, `.disconnected`, `.token_refreshed`, `.token_invalid`, `.revoked`, `.data_deletion`.
- Settings: `settings.changed` (kill switch, rights defaults, taxonomy), `user.role_changed`.
Audit data is redacted with the same scrubber as logs. The Health page and entity pages show audit trails.

## 12.7 Safe logging [S§19]
- pino with `redact` paths: `*.access_token`, `*.accessToken`, `*.token`, `*.refresh_token`, `*.client_secret`, `*.authorization`, `*.Authorization`, `*.cookie`, `*.password`, `*.apiKey`, `*.code` (OAuth code), `*.signed_request`.
- URL scrubber for any logged URL: removes query values of `access_token`, `client_secret`, `code`, `signed_request`, and every `X-Amz-*` parameter (**presigned URLs are bearer credentials**). The Instagram HTTP wrapper logs only the path.
- Error serializer drops request configs and headers from SDK errors.
- Model prompts and outputs (they contain source IP) stay in `generation_runs` (DB access only). Logs carry ids, sizes, token counts — not the text.
- The same scrubber runs in Sentry `beforeSend`. Unit tests cover every rule (M0-05).

## 12.8 Privacy and data protection
- No customer PII in MVP (A-10): attribution uses campaign ids, order ids or their hashes, amounts.
- Personal data stored: team members' emails and names; Instagram account usernames and ids (business data).
- Data residency: Supabase EU (Frankfurt), R2 EU jurisdiction, Vercel `fra1`; Trigger.dev region ⚠ V-17; AI vendors process data under their API terms (B-03).
- Meta requirements: deauthorize and data-deletion callbacks, privacy policy URL (B-13).
- Retention: keep everything during MVP (learning data); a cleanup job for temp files is P2.

## 12.9 Observability [S§23 item 13]
- **Structured logs** (pino JSON): `ts, level, msg, service (web|jobs), env, release, requestId, runId, taskId, userId, entityType, entityId, market, durationMs, err{name, message, code}`. Web logs in Vercel; job logs in Trigger.dev run logs; optional log drain (P2).
- **Correlation**: middleware sets `x-request-id` → `ServiceContext.requestId` → job payload `meta.requestId` → job logger → `audit_events.request_id` / `job_run_id`.
- **Error tracking**: Sentry for web (server + client) and jobs; release = git SHA; environment tag; scrubbed.
- **Job monitoring**: Trigger.dev dashboard + alerts (06 §6.1); domain status fields; stuck detectors (dispatcher recovery for publications; Health warning for sources PROCESSING > 2 h and variants GENERATING > 30 min).
- **External API error visibility**: `publish_attempts` (every Meta call), `integration_events` (errors and warnings per integration), `generation_runs` (status, error, stop reason). Entity pages show human-readable messages with the raw code and `fbtrace_id`.
- **Admin health indicators** (Dashboard tiles + `/settings/health`, H-01):

| Indicator | Green | Amber | Red |
|---|---|---|---|
| Instagram account (per market) | token VALID, > 14 days left | expires in ≤ 14 days, or quota > 80 % | NEEDS_REAUTH / REVOKED |
| Publishing | enabled, no failure in 7 days | kill switch off, or publication QUEUED > 15 min | FAILED publication in 7 days |
| Jobs (domain) | no failures in 24 h | 1–2 failures | ≥ 3 failures or a stuck item |
| Insights freshness | oldest due snapshot < 3 h late | 3–24 h late | > 24 h late |
| AI providers | no errors in 24 h | REFUSED / INVALID_OUTPUT > 5 % | provider errors > 20 % |
| AI cost | < 80 % of monthly budget | 80–100 % | > 100 % |
| DB / storage | `/api/health` ok | slow (> 2 s) | failing |

- **Alerts**: Trigger.dev (failed publish, ingestion, token refresh, insights); Sentry (new issue, spike); uptime monitor on `/api/health` (P1); daily health digest email (P2).

## 12.10 Backups and recovery
- Supabase daily backups; point-in-time recovery depends on the plan ⚠ V-20 (recommended for prod).
- Sources can be re-uploaded (originals stay with Reg.Chef); renders can be rebuilt from approved snapshots and assets.
- Migrations are forward-only; rollback = new migration.
- Runbooks (H-03): publishing incident (kill switch → investigate → reconcile), token re-auth, re-ingestion, prompt rollback (switch active version in `ai/config.ts`), cost spike.
