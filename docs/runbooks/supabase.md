# Supabase: projects and connection strings

Plan: 01 D-03, 04 §4.1, §4.7. Verified against Supabase docs on 2026-09-27 (V-20, database part).

## Projects
- `regchef-dev` and `regchef-prod`, region **EU Central (Frankfurt)**. Exception: the existing dev project runs in `eu-west-2` (London), see decision-log 2026-09-27.
- Database → Extensions: nothing to enable by hand. Migration `0000_extensions` creates `vector` in the `extensions` schema.
- RLS is enabled on every table without policies (04 §4.1), so the Supabase REST API exposes nothing. The app connects as the database owner.

## Connection strings
Find them under **Connect** in the project dashboard. Put them in `.env` (local), Vercel and Trigger.dev; never in git.

| Variable | Use | Mode | Format |
|---|---|---|---|
| `DATABASE_URL` | web (Vercel), jobs (Trigger.dev) | Shared pooler, **transaction** mode, port **6543**, IPv4 | `postgresql://postgres.<ref>:<password>@<pooler-host>:6543/postgres` |
| `DATABASE_URL_DIRECT` | `pnpm db:migrate` (local, CI prod-migrate job) | Shared pooler, **session** mode, port **5432**, IPv4 — or the direct connection | `postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres` or `postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres` |

- Transaction mode does not support prepared statements. `createDb(url, { pooled: true })` sets `prepare: false`; `isPoolerUrl()` detects port 6543.
- The direct connection (`db.<ref>.supabase.co`) is IPv6 only unless the IPv4 add-on is bought. From networks without IPv6 use the session pooler.
- Keep `max` small in serverless functions (default 5 per instance).

## Apply migrations
```bash
cp .env.example .env        # fill DATABASE_URL and DATABASE_URL_DIRECT
pnpm db:migrate
```
Expected: `db:migrate: done (<host>)`. Running it again is a no-op. Check in the SQL editor:
`select extname, extnamespace::regnamespace from pg_extension where extname = 'vector';` → `vector | extensions`.

## Seed reference data
Set `SEED_OWNER_EMAILS` in `.env`, then:
```bash
pnpm db:seed
```
It inserts only missing rows (brand, markets, taxonomy, owners, settings) and prints how many per table; a second run prints zeros. Existing rows, including edits made in the app, are never changed.

## Auth (magic link, plan 01 D-07, M0-15)
Supabase is used for **auth only**, from the server (no browser client, no `NEXT_PUBLIC_*` keys).

1. **Authentication → Sign In / Providers → Email**: enabled; **Allow new users to sign up: off**.
2. **Authentication → URL Configuration**: Site URL = `http://localhost:3000` (dev project) / the prod domain; add preview domains to Redirect URLs.
3. **Authentication → Emails → Magic Link** template, link:
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
   ```
   `/auth/confirm` calls `verifyOtp` on the server and sets the session cookies.
4. **Users**: sign-ups are off and the app calls `signInWithOtp({ shouldCreateUser: false })`, so each person needs a Supabase user. Authentication → Users → **Add user → Create new user** (email, auto-confirm) — or **Send invitation**. The same email must be an active row in `app_users` (`pnpm db:seed` for owners; later the settings UI).
5. `.env`: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the anon or publishable key from Project Settings → API). `SUPABASE_SERVICE_ROLE_KEY` only for E2E test-login (non-production).
6. **Production: custom SMTP** (Authentication → Emails → SMTP settings). The default mailer is for testing only: low rate limits, one link per address per 60 s, links expire after 1 h.

How it works: `proxy.ts` refreshes the session and redirects to `/login`; `requireUser()` verifies the JWT with `getClaims()` and checks the allowlist (`resolveAppUser`): first login links `app_users.auth_user_id` (audit `user.linked`); unknown, inactive or mismatched users are signed out with a message. `requestMagicLink` always answers "sent" and only emails active allowlisted users.

## Still to verify
V-20 remainder: PITR by plan (H-03).
