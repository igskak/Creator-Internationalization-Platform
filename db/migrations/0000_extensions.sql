-- 0000_extensions (M0-09, plan 04 §4.2). Must apply on Supabase and on PGlite (04 §4.7 rule 4).
-- Supabase installs extensions into the "extensions" schema, which is on the search_path of the
-- postgres role. PGlite has no such schema, so fall back to the default schema there.
-- gen_random_uuid() is built into Postgres 13+; no other extension is needed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END
$$;
