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
  const client = postgres(url, {
    prepare: !pooled,
    max,
    onnotice: () => {},
    // A connection that sat idle may have been dropped by a NAT, a phone hotspot or the pooler
    // without telling us; a query on it would then hang for minutes. Close idle connections
    // early so the next query opens a fresh one, and give up on a connection attempt that stalls.
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return {
    db: drizzle({ client, schema, casing: "snake_case" }),
    close: () => client.end({ timeout: 5 }),
  };
}

/** Supabase transaction pooler URLs use port 6543. */
export function isPoolerUrl(url: string): boolean {
  return new URL(url).port === "6543";
}
