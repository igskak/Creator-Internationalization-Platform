import { EnvValidationError, loadDbEnv } from "@rc/lib/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { isPoolerUrl } from "./client";
import { MIGRATIONS_FOLDER } from "./paths";

// `pnpm db:migrate`: applies pending migrations. Prefers DATABASE_URL_DIRECT (direct connection or
// session pooler, port 5432); falls back to DATABASE_URL.
const env = (() => {
  try {
    return loadDbEnv();
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    console.error(`db:migrate: ${error.message}`);
    process.exit(1);
  }
})();
const url = env.directUrl ?? env.url;
const pooled = isPoolerUrl(url);
if (pooled) {
  console.warn("db:migrate: using the transaction pooler; set DATABASE_URL_DIRECT for migrations.");
}

const client = postgres(url, { max: 1, prepare: !pooled, onnotice: () => {} });
try {
  await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
  console.log(`db:migrate: done (${new URL(url).host})`);
} finally {
  await client.end({ timeout: 5 });
}
