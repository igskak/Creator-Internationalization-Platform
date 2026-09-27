import type { AnyDatabase } from "@rc/db";
import type { Logger } from "@rc/lib/logging";
import { type Clock, systemClock } from "./clock";
import { disabledJobRunner, type JobRunner } from "./job-runner";

export type UserRole = "owner" | "editor" | "chef";

/** Who performs the work; written to audit_events. */
export type Actor =
  | { type: "USER"; userId: string; role: UserRole }
  | { type: "SYSTEM" }
  | { type: "JOB"; jobRunId: string };

/**
 * Everything a service needs (plan 02 §2.2, 03 §3.3). Services never read env or globals.
 * Storage and AI providers are added by the tasks that first use them.
 */
export type ServiceContext = {
  db: AnyDatabase;
  logger: Logger;
  clock: Clock;
  actor: Actor;
  /** Correlates web request → job → audit rows (plan 12 §12.9). */
  requestId: string | undefined;
  /** Starts background jobs; use triggerJob() to pass the request id along. */
  jobs: JobRunner;
};

export type CreateServiceContextInput = {
  db: AnyDatabase;
  logger: Logger;
  actor: Actor;
  requestId?: string;
  clock?: Clock;
  /** Default: a runner that refuses to start jobs. */
  jobs?: JobRunner;
};

/** Builds a context and binds requestId and actor to its logger. */
export function createServiceContext(input: CreateServiceContextInput): ServiceContext {
  const bindings: Record<string, string> = { actorType: input.actor.type };
  if (input.requestId) bindings.requestId = input.requestId;
  if (input.actor.type === "USER") bindings.userId = input.actor.userId;
  if (input.actor.type === "JOB") bindings.runId = input.actor.jobRunId;
  return {
    db: input.db,
    logger: input.logger.child(bindings),
    clock: input.clock ?? systemClock,
    actor: input.actor,
    requestId: input.requestId,
    jobs: input.jobs ?? disabledJobRunner,
  };
}

/** Runs `fn` in a transaction; the context passed to `fn` uses the transaction. Nested calls use savepoints. */
export function withTransaction<T>(
  ctx: ServiceContext,
  fn: (txCtx: ServiceContext) => Promise<T>,
): Promise<T> {
  return ctx.db.transaction((tx) => fn({ ...ctx, db: tx }));
}
