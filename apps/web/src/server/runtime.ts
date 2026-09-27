import "server-only";
import { type AnyDatabase, createDb, isPoolerUrl } from "@rc/db";
import { loadServerEnv, type ServerEnv } from "@rc/lib/env";
import { createLogger, type Logger } from "@rc/lib/logging";

// Process-wide clients, created on first use (never at build time).

let env: ServerEnv | undefined;
let db: AnyDatabase | undefined;
let logger: Logger | undefined;

export function serverEnv(): ServerEnv {
  env ??= loadServerEnv();
  return env;
}

export function serverDb(): AnyDatabase {
  const { url } = serverEnv().db;
  db ??= createDb(url, { pooled: isPoolerUrl(url), max: 5 }).db;
  return db;
}

export function serverLogger(): Logger {
  const e = serverEnv();
  logger ??= createLogger({ service: "web", env: e.appEnv, level: e.observability.logLevel });
  return logger;
}
