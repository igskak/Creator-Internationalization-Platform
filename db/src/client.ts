import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;
/** Any Drizzle database or transaction over our schema: postgres.js, PGlite or a `tx`. */
export type AnyDatabase = PgDatabase<PgQueryResultHKT, Schema>;

export type CreateDbOptions = {
  /**
   * True for the Supabase transaction pooler (port 6543): prepared statements are not supported
   * there, so they are turned off (V-20).
   */
  pooled: boolean;
  /** Connections in the pool. Keep small in serverless functions. Default 5. */
  max?: number;
};

export type DbHandle = {
  db: Database;
  /** Closes all connections; call in scripts and at job shutdown. */
  close: () => Promise<void>;
};

export function createDb(url: string, { pooled, max = 5 }: CreateDbOptions): DbHandle {
  const client = postgres(url, { prepare: !pooled, max, onnotice: () => {} });
  return {
    db: drizzle({ client, schema, casing: "snake_case" }),
    close: () => client.end({ timeout: 5 }),
  };
}

/** Supabase transaction pooler URLs use port 6543. */
export function isPoolerUrl(url: string): boolean {
  return new URL(url).port === "6543";
}
