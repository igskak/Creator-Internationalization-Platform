import "server-only";
import { randomUUID } from "node:crypto";
import {
  type Actor,
  createInlineJobRunner,
  createServiceContext,
  createTriggerDevJobRunner,
  type JobRunner,
  type ServiceContext,
} from "@rc/modules/core";
import { jobHandlers } from "@rc/modules/job-handlers";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER } from "./request-id";
import { serverDb, serverEnv, serverLogger, serverStorage } from "./runtime";

let jobs: JobRunner | undefined;

/** Jobs through Trigger.dev, or in-process in the background for `JOBS_MODE=inline` (dev). */
function jobRunner(): JobRunner {
  if (jobs) return jobs;
  const env = serverEnv();
  if (env.jobs.mode === "trigger") {
    jobs = createTriggerDevJobRunner({ secretKey: env.jobs.triggerSecretKey });
    return jobs;
  }
  const runner = createInlineJobRunner({
    handlers: jobHandlers,
    mode: "background",
    makeContext: (runId, meta) =>
      createServiceContext({
        db: serverDb(),
        logger: serverLogger(),
        actor: { type: "JOB", jobRunId: runId },
        ...(meta.requestId ? { requestId: meta.requestId } : {}),
        jobs: runner,
        storage: serverStorage(),
      }),
  });
  jobs = runner;
  return jobs;
}

/** The `x-request-id` header (set by the proxy from M0-19 on), or a new id. */
export async function currentRequestId(): Promise<string> {
  return (await headers()).get(REQUEST_ID_HEADER) ?? randomUUID();
}

/** ServiceContext for one request (plan 03 §3.1 `src/server/context.ts`). */
export async function requestContext(actor: Actor, requestId?: string): Promise<ServiceContext> {
  return createServiceContext({
    db: serverDb(),
    logger: serverLogger(),
    actor,
    requestId: requestId ?? (await currentRequestId()),
    jobs: jobRunner(),
    storage: serverStorage(),
  });
}
