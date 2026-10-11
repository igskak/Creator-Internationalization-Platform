import { randomUUID } from "node:crypto";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { MIGRATIONS_FOLDER } from "./paths";
import * as schema from "./schema";

export type PostgresTestDb = {
  /** URL of the throw-away database. */
  url: string;
  /** Opens one more connection pool to it, for code that must run concurrently. */
  connect: () => { db: PostgresJsDatabase<typeof schema>; close: () => Promise<void> };
  /** Closes the pools opened here and drops the database. */
  drop: () => Promise<void>;
};

/**
 * A throw-away database on a REAL Postgres (`TEST_POSTGRES_URL`, a pgvector-enabled server such as
 * the CI service container), with all migrations applied. PGlite has one connection, so tests
 * of locks and parallel claims (`FOR UPDATE SKIP LOCKED`, unique indexes under a race) need this.
 * Each call makes its own database; `drop()` removes it.
 */
export async function createPostgresTestDb(adminUrl: string): Promise<PostgresTestDb> {
  const name = `rc_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  await admin.end({ timeout: 5 });

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const opened: ReturnType<typeof postgres>[] = [];
  const open = (max: number) => {
    const client = postgres(url.toString(), { max, onnotice: () => {} });
    opened.push(client);
    return client;
  };
  const setup = open(1);
  await migrate(drizzle({ client: setup }), { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    url: url.toString(),
    connect: () => {
      const client = open(3);
      return {
        db: drizzle({ client, schema, casing: "snake_case" }),
        close: () => client.end({ timeout: 5 }),
      };
    },
    drop: async () => {
      await Promise.all(opened.map((c) => c.end({ timeout: 5 }).catch(() => {})));
      const cleaner = postgres(adminUrl, { max: 1, onnotice: () => {} });
      await cleaner.unsafe(`drop database if exists ${name} with (force)`);
      await cleaner.end({ timeout: 5 });
    },
  };
}
