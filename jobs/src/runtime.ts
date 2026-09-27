import { type AnyDatabase, createDb, isPoolerUrl } from "@rc/db";
import { loadServerEnv } from "@rc/lib/env";
import { createLogger, type Logger } from "@rc/lib/logging";
import {
  createServiceContext,
  createTriggerDevJobRunner,
  type JobMeta,
  type JobRunner,
  type ServiceContext,
} from "@rc/modules/core";

type Runtime = { logger: Logger; db: AnyDatabase; jobs: JobRunner | undefined };

// One set of clients per worker process, created on first use.
let shared: Runtime | undefined;

function createRuntime(): Runtime {
  const env = loadServerEnv();
  const logger = createLogger({
    service: "jobs",
    env: env.appEnv,
    level: env.observability.logLevel,
  });
  const { db } = createDb(env.db.url, { pooled: isPoolerUrl(env.db.url), max: 3 });
  // Jobs started from a job go through Trigger.dev as well.
  const jobs =
    env.jobs.mode === "trigger"
      ? createTriggerDevJobRunner({ secretKey: env.jobs.triggerSecretKey })
      : undefined;
  return { logger, db, jobs };
}

/** Service context for one Trigger.dev run (actor JOB, run id, request id from the envelope). */
export function jobContext(runId: string, taskId: string, meta: JobMeta): ServiceContext {
  shared ??= createRuntime();
  const { logger, db, jobs } = shared;
  return createServiceContext({
    db,
    logger: logger.child({ taskId }),
    actor: { type: "JOB", jobRunId: runId },
    ...(meta.requestId ? { requestId: meta.requestId } : {}),
    ...(jobs ? { jobs } : {}),
  });
}
