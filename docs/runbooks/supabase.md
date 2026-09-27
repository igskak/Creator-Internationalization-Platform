# Supabase: projects and connection strings

Plan: 01 D-03, 04 §4.1, §4.7. Verified against Supabase docs on 2026-09-27 (V-20, database part).

## Projects
- `regchef-dev` and `regchef-prod`, region **EU Central (Frankfurt)**.
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

## Still to verify
V-20 remainder (Auth email OTP + custom SMTP, PITR by plan) belongs to M0-15 and H-03.
