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
import { serverDb, serverEnv, serverLogger } from "./runtime";

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
      }),
  });
  jobs = runner;
  return jobs;
}

/** ServiceContext for one request (plan 03 §3.1 `src/server/context.ts`). */
export async function requestContext(actor: Actor): Promise<ServiceContext> {
  const requestId = (await headers()).get("x-request-id") ?? randomUUID();
  return createServiceContext({
    db: serverDb(),
    logger: serverLogger(),
    actor,
    requestId,
    jobs: jobRunner(),
  });
}
