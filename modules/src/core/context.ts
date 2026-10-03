import type { AnyDatabase } from "@rc/db";
import { PermanentError } from "@rc/lib/errors";
import type { Logger } from "@rc/lib/logging";
import type { EmbeddingProvider } from "@rc/lib/providers/embeddings";
import type { LLMProvider } from "@rc/lib/providers/llm";
import type { StorageProvider } from "@rc/lib/providers/storage";
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
 * The image provider is added by the task that first uses it.
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
  /** Private object storage (R2, or in-memory in tests). */
  storage: StorageProvider;
  /** Language model; every call goes through runStage(). */
  llm: LLMProvider;
  /** Text embeddings for `vector(1536)` columns. */
  embeddings: EmbeddingProvider;
};

export type CreateServiceContextInput = {
  db: AnyDatabase;
  logger: Logger;
  actor: Actor;
  requestId?: string;
  clock?: Clock;
  /** Default: a runner that refuses to start jobs. */
  jobs?: JobRunner;
  /** Default: a provider that refuses every call. */
  storage?: StorageProvider;
  /** Default: a provider that refuses every call. */
  llm?: LLMProvider;
  /** Default: a provider that refuses every call. */
  embeddings?: EmbeddingProvider;
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
    storage: input.storage ?? disabledStorage,
    llm: input.llm ?? disabledLlm,
    embeddings: input.embeddings ?? disabledEmbeddings,
  };
}

const storageDisabled = (): never => {
  throw new PermanentError("No storage provider is configured for this context.");
};

/** Default for contexts that must not touch storage. */
export const disabledStorage: StorageProvider = {
  presignPut: storageDisabled,
  presignGet: storageDisabled,
  head: storageDisabled,
  getStream: storageDisabled,
  getBytes: storageDisabled,
  put: storageDisabled,
  delete: storageDisabled,
};

/** Default for contexts that must not call a model. */
export const disabledLlm: LLMProvider = {
  id: "fake",
  generateStructured: async () => {
    throw new PermanentError("No LLM provider is configured for this context.");
  },
};

/** Default for contexts that must not embed text. */
export const disabledEmbeddings: EmbeddingProvider = {
  id: "fake",
  model: "disabled",
  dimensions: 0,
  embed: async () => {
    throw new PermanentError("No embedding provider is configured for this context.");
  },
};

/** Runs `fn` in a transaction; the context passed to `fn` uses the transaction. Nested calls use savepoints. */
export function withTransaction<T>(
  ctx: ServiceContext,
  fn: (txCtx: ServiceContext) => Promise<T>,
): Promise<T> {
  return ctx.db.transaction((tx) => fn({ ...ctx, db: tx }));
}
