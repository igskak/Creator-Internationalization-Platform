import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Booting PGlite runs initdb (~1.4 s) and migrations. Instead, build one migrated template, dump
// its data directory, and start every test database from that dump (~0.3 s). The dump is cached
// in the OS temp dir under a hash of the migration files, so all test files and runs share it
// until a migration changes.
let template: Promise<Blob> | undefined;

async function migrationsHash(): Promise<string> {
  const hash = createHash("sha256");
  const files = (await readdir(MIGRATIONS_FOLDER, { recursive: true })).sort();
  for (const file of files) {
    if (!file.endsWith(".sql") && !file.endsWith("_journal.json")) continue;
    hash.update(file).update(await readFile(join(MIGRATIONS_FOLDER, file)));
  }
  return hash.digest("hex").slice(0, 16);
}

async function buildTemplate(): Promise<Blob> {
  const client = await PGlite.create({ extensions: { vector } });
  await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER });
  const dump = await client.dumpDataDir("none");
  await client.close();
  return dump;
}

async function loadTemplate(): Promise<Blob> {
  const dir = join(tmpdir(), "rc-test-db");
  const path = join(dir, `template-${await migrationsHash()}.tar`);
  try {
    return new Blob([await readFile(path)]);
  } catch {
    const dump = await buildTemplate();
    await mkdir(dir, { recursive: true });
    const partial = `${path}.${randomUUID()}.tmp`;
    await writeFile(partial, new Uint8Array(await dump.arrayBuffer()));
    await rename(partial, path); // atomic, so parallel workers never read a half-written file
    return dump;
  }
}

/**
 * In-memory Postgres (PGlite) with pgvector and all migrations applied. Each call returns an
 * independent database; no Docker needed. PGlite is single-connection, so concurrency tests need
 * real Postgres.
 */
export async function createTestDb(): Promise<TestDb> {
  template ??= loadTemplate();
  const client = await PGlite.create({ extensions: { vector }, loadDataDir: await template });
  const db = drizzle({ client, schema, casing: "snake_case" });
  return { db, client, close: () => client.close() };
}
