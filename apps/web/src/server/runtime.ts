import "server-only";
import { type AnyDatabase, createDb, type DbHandle, isPoolerUrl } from "@rc/db";
import { loadServerEnv, runtimeDatabaseUrl, type ServerEnv } from "@rc/lib/env";
import { createLogger, type Logger } from "@rc/lib/logging";
import { createEmbeddingProvider, type EmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createImageProvider, type ImageProvider } from "@rc/lib/providers/image";
import { createLlmProvider, type LLMProvider } from "@rc/lib/providers/llm";
import { createStorage, type StorageProvider } from "@rc/lib/providers/storage";
import { createE2eLlm } from "@rc/modules/ai";
import { after } from "next/server";

// Process-wide clients, created on first use (never at build time).

let env: ServerEnv | undefined;
let dbHandle: DbHandle | undefined;
let requestsUsingDb = 0;
let logger: Logger | undefined;
let storage: StorageProvider | undefined;
let llm: LLMProvider | undefined;
let embeddings: EmbeddingProvider | undefined;
let images: ImageProvider | undefined;

export function serverEnv(): ServerEnv {
  env ??= loadServerEnv();
  return env;
}

/** Deployed (Vercel runs `staging` and `production`), as opposed to a developer's machine or a test. */
function isServerless(env: ServerEnv): boolean {
  return env.appEnv === "staging" || env.appEnv === "production";
}

export function serverDb(): AnyDatabase {
  const env = serverEnv();
  const url = runtimeDatabaseUrl(env.db, env.appEnv);
  // Every serverless instance has its own pool, and a page makes several requests at once (the
  // sidebar prefetches), so five connections per instance exhaust the pooler's client limit and
  // queries start to fail at random. A small pool queues instead of failing.
  const max = isServerless(env) ? 2 : 5;
  dbHandle ??= createDb(url, { pooled: isPoolerUrl(url), max });
  return dbHandle.db;
}

/**
 * Call once per request that uses `serverDb()`. A serverless instance is frozen between requests,
 * so the pool's idle timer cannot run there and its connections stay open, each holding one of the
 * session pooler's 15 slots until the instance is thrown away. The pool is therefore closed when
 * the last request using it has finished; the next request opens a new one.
 */
export function releaseDbAfterRequest(): void {
  if (!isServerless(serverEnv())) return;
  requestsUsingDb += 1;
  try {
    after(releaseDb);
  } catch {
    // Not inside a request (a script or a test): nothing will release it, so do not count it.
    requestsUsingDb -= 1;
  }
}

async function releaseDb(): Promise<void> {
  requestsUsingDb -= 1;
  if (requestsUsingDb > 0 || !dbHandle) return;
  const handle = dbHandle;
  dbHandle = undefined;
  await handle.close().catch(() => {});
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

export function serverImages(): ImageProvider {
  images ??= createImageProvider(serverEnv().ai);
  return images;
}
