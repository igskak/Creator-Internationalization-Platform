import { randomUUID } from "node:crypto";
import { PermanentError, ValidationError } from "@rc/lib/errors";
import { configure, idempotencyKeys, tasks } from "@trigger.dev/sdk";
import type { z } from "zod";
import type { ServiceContext } from "./context";

// Plan 06 §6.5. Jobs are thin: validate payload → build a JOB context → call one handler.

export type JobDefinition<S extends z.ZodType = z.ZodType, R = unknown> = {
  payload: S;
  run: (ctx: ServiceContext, payload: z.output<S>) => Promise<R>;
};

export function defineJob<S extends z.ZodType, R>(definition: JobDefinition<S, R>) {
  return definition;
}

/**
 * Job name → definition. Filled by modules/src/job-handlers.ts through declaration merging, so
 * core knows names and payload types without importing the handlers (no cycle).
 */
// biome-ignore lint/suspicious/noEmptyInterface: extended by declaration merging
export interface JobRegistry {}
export type JobName = keyof JobRegistry & string;
export type JobPayload<N extends JobName> =
  JobRegistry[N] extends JobDefinition<infer S, unknown> ? z.input<S> : never;

/** Correlation data sent with every job (plan 12 §12.9). */
export type JobMeta = { requestId?: string };
/** What travels to the job runtime. */
export type JobEnvelope = { payload: unknown; meta: JobMeta };

export type TriggerOptions = {
  /** Always global scope in the Trigger.dev runner (V-17). */
  idempotencyKey?: string;
  delaySeconds?: number;
  concurrencyKey?: string;
  tags?: string[];
  requestId?: string;
};

export type JobRunner = {
  trigger<N extends JobName>(
    name: N,
    payload: JobPayload<N>,
    options?: TriggerOptions,
  ): Promise<{ runId: string }>;
};

/** Validates the payload and runs the handler; shared by the inline runner and Trigger.dev tasks. */
export async function runJobHandler(
  definition: JobDefinition,
  ctx: ServiceContext,
  rawPayload: unknown,
): Promise<unknown> {
  const parsed = definition.payload.safeParse(rawPayload);
  if (!parsed.success) {
    throw ValidationError.fromZod(parsed.error, "Invalid job payload.");
  }
  return definition.run(ctx, parsed.data);
}

/** Triggers a job with the context's request id attached. */
export function triggerJob<N extends JobName>(
  ctx: ServiceContext,
  name: N,
  payload: JobPayload<N>,
  options: Omit<TriggerOptions, "requestId"> = {},
): Promise<{ runId: string }> {
  return ctx.jobs.trigger(name, payload, {
    ...options,
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
  });
}

/** Default for contexts that must not start jobs. */
export const disabledJobRunner: JobRunner = {
  trigger: async (name) => {
    throw new PermanentError("No job runner is configured for this context.", {
      details: { job: name },
    });
  },
};

type RunRecord = { status: "running" | "succeeded" | "failed"; result?: unknown; error?: unknown };

export type InlineJobRunnerOptions = {
  handlers: Record<string, JobDefinition>;
  /** Builds the JOB context for one run. */
  makeContext: (runId: string, meta: JobMeta) => ServiceContext;
  /** `await` (tests): trigger resolves after the handler and rethrows its error. Default `await`. */
  mode?: "await" | "background";
  newRunId?: () => string;
};

/**
 * Runs handlers in-process (tests, E2E, local dev without Trigger.dev). Idempotency keys behave
 * like Trigger.dev: a key of a running or succeeded run returns that run; a failed run's key is
 * cleared. Delays are ignored.
 */
export function createInlineJobRunner(options: InlineJobRunnerOptions) {
  const mode = options.mode ?? "await";
  const newRunId = options.newRunId ?? (() => `inline_${randomUUID()}`);
  const runs = new Map<string, RunRecord>();
  const keys = new Map<string, string>();

  const runner: JobRunner & { getRun(runId: string): RunRecord | undefined } = {
    async trigger(name, payload, triggerOptions = {}) {
      const definition = options.handlers[name];
      if (!definition) throw new PermanentError("Unknown job.", { details: { job: name } });

      const key = triggerOptions.idempotencyKey && `${name}:${triggerOptions.idempotencyKey}`;
      const existing = key ? keys.get(key) : undefined;
      if (existing && runs.get(existing)?.status !== "failed") return { runId: existing };

      const runId = newRunId();
      if (key) keys.set(key, runId);
      const record: RunRecord = { status: "running" };
      runs.set(runId, record);
      const meta: JobMeta = triggerOptions.requestId ? { requestId: triggerOptions.requestId } : {};
      const ctx = options.makeContext(runId, meta);

      const execution = runJobHandler(definition, ctx, payload).then(
        (result) => {
          record.status = "succeeded";
          record.result = result;
        },
        (error: unknown) => {
          record.status = "failed";
          record.error = error;
          ctx.logger.error({ err: error, job: name }, "inline job failed");
          throw error;
        },
      );
      if (mode === "await") await execution;
      else execution.catch(() => {});
      return { runId };
    },
    getRun: (runId) => runs.get(runId),
  };
  return runner;
}

type TriggerSdk = {
  trigger: (
    name: string,
    envelope: JobEnvelope,
    options: Record<string, unknown>,
  ) => Promise<{ id: string }>;
  createIdempotencyKey: (key: string) => Promise<string>;
};

const defaultSdk: TriggerSdk = {
  trigger: (name, envelope, options) => tasks.trigger(name, envelope, options),
  createIdempotencyKey: async (key) => idempotencyKeys.create(key, { scope: "global" }),
};

/**
 * Triggers Trigger.dev tasks (task id = job name) from web or jobs. Idempotency keys are always
 * created with global scope: raw strings default to run scope since v4.3.1 (V-17).
 */
export function createTriggerDevJobRunner(
  { secretKey }: { secretKey: string },
  sdk: TriggerSdk = defaultSdk,
): JobRunner {
  if (sdk === defaultSdk) configure({ accessToken: secretKey });
  return {
    async trigger(name, payload, triggerOptions = {}) {
      const meta: JobMeta = triggerOptions.requestId ? { requestId: triggerOptions.requestId } : {};
      const options: Record<string, unknown> = {};
      if (triggerOptions.idempotencyKey) {
        options.idempotencyKey = await sdk.createIdempotencyKey(
          `${name}:${triggerOptions.idempotencyKey}`,
        );
      }
      if (triggerOptions.delaySeconds) options.delay = `${Math.ceil(triggerOptions.delaySeconds)}s`;
      if (triggerOptions.concurrencyKey) options.concurrencyKey = triggerOptions.concurrencyKey;
      if (triggerOptions.tags?.length) options.tags = triggerOptions.tags;
      const handle = await sdk.trigger(name, { payload, meta }, options);
      return { runId: handle.id };
    },
  };
}
