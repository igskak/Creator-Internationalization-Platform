import { type AnyDatabase, createDb, isPoolerUrl } from "@rc/db";
import { loadServerEnv, type ServerEnv } from "@rc/lib/env";
import { createLogger, type Logger } from "@rc/lib/logging";
import { createEmbeddingProvider, type EmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createLlmProvider, type LLMProvider } from "@rc/lib/providers/llm";
import { createStorage, type StorageProvider } from "@rc/lib/providers/storage";
import {
  createServiceContext,
  createTriggerDevJobRunner,
  type JobMeta,
  type JobRunner,
  type ServiceContext,
} from "@rc/modules/core";

type Runtime = {
  logger: Logger;
  db: AnyDatabase;
  jobs: JobRunner | undefined;
  storage: StorageProvider;
  llm: LLMProvider;
  embeddings: EmbeddingProvider;
};

// One set of clients per worker process, created on first use.
let shared: Runtime | undefined;

let env: ServerEnv | undefined;

/** Validated environment of the worker process (loaded once). */
export function jobEnv(): ServerEnv {
  env ??= loadServerEnv();
  return env;
}

function createRuntime(): Runtime {
  const env = jobEnv();
  const logger = createLogger({
    service: "jobs",
    env: env.appEnv,
    level: env.observability.logLevel,
    ...(env.observability.release ? { release: env.observability.release } : {}),
  });
  const { db } = createDb(env.db.url, { pooled: isPoolerUrl(env.db.url), max: 3 });
  // Jobs started from a job go through Trigger.dev as well.
  const jobs =
    env.jobs.mode === "trigger"
      ? createTriggerDevJobRunner({ secretKey: env.jobs.triggerSecretKey })
      : undefined;
  return {
    logger,
    db,
    jobs,
    storage: createStorage(env.storage),
    llm: createLlmProvider(env.ai),
    embeddings: createEmbeddingProvider(env.ai),
  };
}

/** Service context for one Trigger.dev run (actor JOB, run id, request id from the envelope). */
export function jobContext(runId: string, taskId: string, meta: JobMeta): ServiceContext {
  shared ??= createRuntime();
  const { logger, db, jobs, storage, llm, embeddings } = shared;
  return createServiceContext({
    db,
    logger: logger.child({ taskId }),
    actor: { type: "JOB", jobRunId: runId },
    storage,
    llm,
    embeddings,
    ...(meta.requestId ? { requestId: meta.requestId } : {}),
    ...(jobs ? { jobs } : {}),
  });
}
