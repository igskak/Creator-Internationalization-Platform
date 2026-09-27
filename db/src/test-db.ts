import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER } from "./paths";
import * as schema from "./schema";

export type TestDb = {
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
  close: () => Promise<void>;
};

/**
 * In-memory Postgres (PGlite) with pgvector and all migrations applied. One per test file or
 * test; no Docker needed. PGlite is single-connection, so concurrency tests need real Postgres.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle({ client, schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client, close: () => client.close() };
}
