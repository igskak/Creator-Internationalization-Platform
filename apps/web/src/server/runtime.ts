import "server-only";
import { type AnyDatabase, createDb, isPoolerUrl } from "@rc/db";
import { loadServerEnv, runtimeDatabaseUrl, type ServerEnv } from "@rc/lib/env";
import { createLogger, type Logger } from "@rc/lib/logging";
import { createEmbeddingProvider, type EmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createLlmProvider, type LLMProvider } from "@rc/lib/providers/llm";
import { createStorage, type StorageProvider } from "@rc/lib/providers/storage";
import { createE2eLlm } from "@rc/modules/ai";

// Process-wide clients, created on first use (never at build time).

let env: ServerEnv | undefined;
let db: AnyDatabase | undefined;
let logger: Logger | undefined;
let storage: StorageProvider | undefined;
let llm: LLMProvider | undefined;
let embeddings: EmbeddingProvider | undefined;

export function serverEnv(): ServerEnv {
  env ??= loadServerEnv();
  return env;
}

export function serverDb(): AnyDatabase {
  const env = serverEnv();
  const url = runtimeDatabaseUrl(env.db, env.appEnv);
  db ??= createDb(url, { pooled: isPoolerUrl(url), max: 5 }).db;
  return db;
}

export function serverLogger(): Logger {
  const e = serverEnv();
  logger ??= createLogger({
    service: "web",
    env: e.appEnv,
    level: e.observability.logLevel,
    ...(e.observability.release ? { release: e.observability.release } : {}),
  });
  return logger;
}

export function serverStorage(): StorageProvider {
  storage ??= createStorage(serverEnv().storage);
  return storage;
}

export function serverLlm(): LLMProvider {
  const e = serverEnv();
  // The E2E server (E2E_TEST_AUTH_SECRET is refused in production) gets a scripted fake model.
  llm ??=
    e.ai.provider === "fake" && e.e2e.testAuthSecret ? createE2eLlm() : createLlmProvider(e.ai);
  return llm;
}

export function serverEmbeddings(): EmbeddingProvider {
  embeddings ??= createEmbeddingProvider(serverEnv().ai);
  return embeddings;
}
