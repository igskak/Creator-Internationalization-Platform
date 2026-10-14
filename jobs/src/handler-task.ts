import type { JobEnvelope, JobName } from "@rc/modules/core";
import { runJobHandler } from "@rc/modules/core";
import { jobHandlers } from "@rc/modules/job-handlers";
import { type Queue, schedules, task } from "@trigger.dev/sdk";
import { classifyJobError } from "./errors";
import { jobContext } from "./runtime";

/** Machine presets the plan uses (06 §6.1): default small-1x; Chromium and big PDFs medium-1x. */
export type Machine = "small-1x" | "medium-1x" | "large-1x";

type HandlerTaskOptions = {
  queue: Queue;
  machine?: Machine;
  maxDuration?: number;
  /** Replaces the default retry policy of trigger.config.ts (plan 06 §6.2 column "Retries"). */
  retry?: {
    maxAttempts: number;
    factor?: number;
    minTimeoutInMs?: number;
    maxTimeoutInMs?: number;
    randomize?: boolean;
  };
};

/** What a scheduled run receives is Trigger.dev's schedule payload, not our envelope. */
const isEnvelope = (value: unknown): value is JobEnvelope =>
  typeof value === "object" && value !== null && "payload" in value;

async function runHandler(name: JobName, runId: string, incoming: unknown) {
  // A cron run has no payload of ours: the handler gets an empty one (every field is optional).
  const envelope: JobEnvelope = isEnvelope(incoming) ? incoming : { payload: {}, meta: {} };
  const serviceCtx = jobContext(runId, name, envelope.meta ?? {});
  try {
    return await runJobHandler(jobHandlers[name], serviceCtx, envelope.payload);
  } catch (error) {
    throw classifyJobError(error);
  }
}

/** Trigger.dev task whose id is the job name and whose body is the registered handler. */
export function handlerTask(name: JobName, options: HandlerTaskOptions) {
  return task({
    id: name,
    queue: options.queue,
    ...(options.machine ? { machine: options.machine } : {}),
    ...(options.maxDuration ? { maxDuration: options.maxDuration } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
    run: async (envelope: JobEnvelope, { ctx }) => runHandler(name, ctx.run.id, envelope),
  });
}

/**
 * The same, run on a cron schedule in UTC (plan 06 §6.4) and also triggerable by hand with our
 * envelope (e.g. "check health now").
 */
export function cronHandlerTask(name: JobName, cron: string, options: HandlerTaskOptions) {
  return schedules.task({
    id: name,
    cron: { pattern: cron, timezone: "UTC" },
    queue: options.queue,
    ...(options.machine ? { machine: options.machine } : {}),
    ...(options.maxDuration ? { maxDuration: options.maxDuration } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
    run: async (incoming: unknown, { ctx }) => runHandler(name, ctx.run.id, incoming),
  });
}
