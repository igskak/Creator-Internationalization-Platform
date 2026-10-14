import type { AnyDatabase } from "@rc/db";
import type { ServerEnv } from "@rc/lib/env";
import { PermanentError } from "@rc/lib/errors";
import type { Logger } from "@rc/lib/logging";
import type { EmbeddingProvider } from "@rc/lib/providers/embeddings";
import type { ImageProvider } from "@rc/lib/providers/image";
import type { LLMProvider } from "@rc/lib/providers/llm";
import type { StorageProvider } from "@rc/lib/providers/storage";
import { DEFAULT_VIDEO_MODEL, type VideoProvider } from "@rc/lib/providers/video";
import type { KeyRing } from "@rc/lib/security";
import { type Clock, systemClock } from "./clock";
import { disabledJobRunner, type JobRunner } from "./job-runner";

export type UserRole = "owner" | "editor" | "chef";

/** Who performs the work; written to audit_events. */
export type Actor =
  | { type: "USER"; userId: string; role: UserRole }
  | { type: "SYSTEM" }
  | { type: "JOB"; jobRunId: string };

export type PublishMode = "off" | "dry_run_only" | "live";

/** The Meta app of this environment (plan 09 §9.1); only present when publishing is not `off`. */
export type InstagramApp = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphApiVersion: string;
  /** `https://graph.instagram.com`, or the mock Graph API in E2E (`INSTAGRAM_GRAPH_BASE_URL`). */
  graphBaseUrl: string;
  /** Instagram account ids this environment may publish to (plan 09 §9.8). */
  accountAllowlist: readonly string[];
};

/**
 * Instagram settings and secrets for the services of `modules/instagram` (plan 09). `app` is
 * undefined while `INSTAGRAM_PUBLISH_MODE=off`. `fetch` is a test and E2E hook; production uses
 * the global one.
 */
export type InstagramRuntime = {
  publishMode: PublishMode;
  app: InstagramApp | undefined;
  /** Token encryption keys (D-18); undefined in contexts that never touch tokens. */
  keyRing: KeyRing | undefined;
  /** HMAC secret of the OAuth `state` (plan 09 §9.2). */
  stateSecret: string | undefined;
  fetch: typeof fetch | undefined;
};

const timerSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Default for contexts that do not talk to Instagram. */
export const disabledInstagram: InstagramRuntime = {
  publishMode: "off",
  app: undefined,
  keyRing: undefined,
  stateSecret: undefined,
  fetch: undefined,
};

/** Builds the Instagram settings of a context from the validated environment. */
export function instagramRuntimeFromEnv(env: ServerEnv): InstagramRuntime {
  const ig = env.instagram;
  return {
    publishMode: ig.publishMode,
    app:
      ig.publishMode === "off"
        ? undefined
        : {
            appId: ig.appId,
            appSecret: ig.appSecret,
            redirectUri: ig.redirectUri,
            graphApiVersion: ig.graphApiVersion,
            graphBaseUrl: ig.graphBaseUrl,
            accountAllowlist: ig.accountAllowlist,
          },
    keyRing: {
      keys: env.security.tokenEncryptionKeys,
      activeKeyId: env.security.activeKeyId,
    },
    stateSecret: env.security.oauthStateSecret,
    fetch: undefined,
  };
}

/**
 * Everything a service needs (plan 02 §2.2, 03 §3.3). Services never read env or globals.
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
  /** Image generation (M3-03). */
  images: ImageProvider;
  /** Image-to-video shots for Reels (M8-02, M8-06). */
  video: VideoProvider;
  /** Instagram app, publish mode and token keys (M5). */
  instagram: InstagramRuntime;
  /**
   * Waits without using compute where the runtime can (Trigger.dev `wait.for` in a job); a timer
   * elsewhere. Tests pass a function that advances their manual clock.
   */
  sleep: (ms: number) => Promise<void>;
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
  /** Default: a provider that refuses every call. */
  images?: ImageProvider;
  /** Default: a provider that refuses every call. */
  video?: VideoProvider;
  /** Default: publishing off. */
  instagram?: InstagramRuntime;
  /** Default: a timer. */
  sleep?: (ms: number) => Promise<void>;
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
    images: input.images ?? disabledImages,
    video: input.video ?? disabledVideo,
    instagram: input.instagram ?? disabledInstagram,
    sleep: input.sleep ?? timerSleep,
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

/** Default for contexts that must not generate images. */
export const disabledImages: ImageProvider = {
  id: "fake",
  model: "disabled",
  generate: async () => {
    throw new PermanentError("No image provider is configured for this context.");
  },
};

const videoDisabled = (): never => {
  throw new PermanentError("No video provider is configured for this context.", {
    details: { code: "video_disabled" },
  });
};

/** Default for contexts that must not generate video. */
export const disabledVideo: VideoProvider = {
  id: "disabled",
  model: DEFAULT_VIDEO_MODEL,
  submit: async () => videoDisabled(),
  waitFor: async () => videoDisabled(),
  generate: async () => videoDisabled(),
};
