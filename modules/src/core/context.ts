import type { AnyDatabase } from "@rc/db";
import type { Logger } from "@rc/lib/logging";
import { type Clock, systemClock } from "./clock";

export type UserRole = "owner" | "editor" | "chef";

/** Who performs the work; written to audit_events. */
export type Actor =
  | { type: "USER"; userId: string; role: UserRole }
  | { type: "SYSTEM" }
  | { type: "JOB"; jobRunId: string };

/**
 * Everything a service needs (plan 02 §2.2, 03 §3.3). Services never read env or globals.
 * Storage (M0-13), job runner (M0-14) and AI providers (M1-08) are added by their tasks.
 */
export type ServiceContext = {
  db: AnyDatabase;
  logger: Logger;
  clock: Clock;
  actor: Actor;
  /** Correlates web request → job → audit rows (plan 12 §12.9). */
  requestId: string | undefined;
};

export type CreateServiceContextInput = {
  db: AnyDatabase;
  logger: Logger;
  actor: Actor;
  requestId?: string;
  clock?: Clock;
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
  };
}

/** Runs `fn` in a transaction; the context passed to `fn` uses the transaction. Nested calls use savepoints. */
export function withTransaction<T>(
  ctx: ServiceContext,
  fn: (txCtx: ServiceContext) => Promise<T>,
): Promise<T> {
  return ctx.db.transaction((tx) => fn({ ...ctx, db: tx }));
}
