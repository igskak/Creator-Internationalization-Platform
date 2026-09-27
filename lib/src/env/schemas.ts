import { z } from "zod";

// One schema per concern. Each parses the flat variable map and returns a grouped, camelCase
// object. Variables that only some modes need live in a discriminated union on the mode flag.

const required = z.string().min(1);
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const httpsUrl = z.url({ protocol: /^https$/ });

export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const appEnvSchema = z
  .object({ APP_ENV: z.enum(APP_ENVS).default("development") })
  .transform((v) => v.APP_ENV);

export const dbSchema = z
  .object({
    DATABASE_URL: postgresUrl,
    DATABASE_URL_DIRECT: postgresUrl.optional(),
  })
  .transform((v) => ({ url: v.DATABASE_URL, directUrl: v.DATABASE_URL_DIRECT }));

export const supabaseSchema = z
  .object({
    SUPABASE_URL: z.url({ protocol: /^https?$/ }),
    SUPABASE_ANON_KEY: required,
    SUPABASE_SERVICE_ROLE_KEY: required.optional(),
  })
  .transform((v) => ({
    url: v.SUPABASE_URL,
    anonKey: v.SUPABASE_ANON_KEY,
    serviceRoleKey: v.SUPABASE_SERVICE_ROLE_KEY,
  }));

export const storageSchema = z
  .discriminatedUnion("STORAGE_PROVIDER", [
    z.object({ STORAGE_PROVIDER: z.literal("memory") }),
    z.object({
      STORAGE_PROVIDER: z.literal("r2"),
      R2_ACCOUNT_ID: required,
      R2_ACCESS_KEY_ID: required,
      R2_SECRET_ACCESS_KEY: required,
      R2_BUCKET: required,
      RENDERS_PUBLIC_BASE_URL: httpsUrl.optional(),
    }),
  ])
  .transform((v) =>
    v.STORAGE_PROVIDER === "memory"
      ? { provider: "memory" as const }
      : {
          provider: "r2" as const,
          accountId: v.R2_ACCOUNT_ID,
          accessKeyId: v.R2_ACCESS_KEY_ID,
          secretAccessKey: v.R2_SECRET_ACCESS_KEY,
          bucket: v.R2_BUCKET,
          rendersPublicBaseUrl: v.RENDERS_PUBLIC_BASE_URL,
        },
  );

export const aiSchema = z
  .discriminatedUnion("AI_PROVIDER", [
    z.object({ AI_PROVIDER: z.literal("fake") }),
    z.object({
      AI_PROVIDER: z.literal("live"),
      ANTHROPIC_API_KEY: required,
      OPENAI_API_KEY: required,
    }),
  ])
  .transform((v) =>
    v.AI_PROVIDER === "fake"
      ? { provider: "fake" as const }
      : {
          provider: "live" as const,
          anthropicApiKey: v.ANTHROPIC_API_KEY,
          openaiApiKey: v.OPENAI_API_KEY,
        },
  );

export const jobsSchema = z
  .discriminatedUnion("JOBS_MODE", [
    z.object({ JOBS_MODE: z.literal("inline") }),
    z.object({ JOBS_MODE: z.literal("trigger"), TRIGGER_SECRET_KEY: required }),
  ])
  .transform((v) =>
    v.JOBS_MODE === "inline"
      ? { mode: "inline" as const }
      : { mode: "trigger" as const, triggerSecretKey: v.TRIGGER_SECRET_KEY },
  );

const instagramApp = {
  IG_APP_ID: required,
  IG_APP_SECRET: required,
  IG_REDIRECT_URI: z.url({ protocol: /^https?$/ }),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/, "Expected a version like v24.0"),
  INSTAGRAM_GRAPH_BASE_URL: httpsUrl.default("https://graph.instagram.com"),
  INSTAGRAM_ACCOUNT_ALLOWLIST: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
};

export const instagramSchema = z
  .discriminatedUnion("INSTAGRAM_PUBLISH_MODE", [
    z.object({ INSTAGRAM_PUBLISH_MODE: z.literal("off") }),
    z.object({ INSTAGRAM_PUBLISH_MODE: z.literal("dry_run_only"), ...instagramApp }),
    z.object({ INSTAGRAM_PUBLISH_MODE: z.literal("live"), ...instagramApp }),
  ])
  .transform((v) =>
    v.INSTAGRAM_PUBLISH_MODE === "off"
      ? { publishMode: "off" as const }
      : {
          publishMode: v.INSTAGRAM_PUBLISH_MODE,
          appId: v.IG_APP_ID,
          appSecret: v.IG_APP_SECRET,
          redirectUri: v.IG_REDIRECT_URI,
          graphApiVersion: v.META_GRAPH_API_VERSION,
          graphBaseUrl: v.INSTAGRAM_GRAPH_BASE_URL,
          accountAllowlist: v.INSTAGRAM_ACCOUNT_ALLOWLIST,
        },
  );

const KEY_ENTRY = /^(v\d+):([A-Za-z0-9+/]+={0,2})$/;

/** Parses `v1:<base64 of 32 bytes>,v2:…` into key id → key bytes. */
const keyRing = z.string().transform((raw, ctx) => {
  const keys = new Map<string, Uint8Array>();
  for (const entry of raw.split(",")) {
    const match = KEY_ENTRY.exec(entry.trim());
    const bytes = match?.[2] ? Buffer.from(match[2], "base64") : undefined;
    if (!match?.[1] || bytes?.length !== 32 || keys.has(match[1])) {
      ctx.addIssue({
        code: "custom",
        message: "Expected unique comma-separated entries v<N>:<base64 of 32 bytes>",
      });
      return z.NEVER;
    }
    keys.set(match[1], new Uint8Array(bytes));
  }
  return keys as ReadonlyMap<string, Uint8Array>;
});

export const securitySchema = z
  .object({
    TOKEN_ENCRYPTION_KEYS: keyRing,
    TOKEN_ENCRYPTION_ACTIVE_KEY: z.string().regex(/^v\d+$/, "Expected a key id like v1"),
    OAUTH_STATE_SECRET: z.string().min(32),
  })
  .superRefine((v, ctx) => {
    if (!v.TOKEN_ENCRYPTION_KEYS.has(v.TOKEN_ENCRYPTION_ACTIVE_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["TOKEN_ENCRYPTION_ACTIVE_KEY"],
        message: "Key id not found in TOKEN_ENCRYPTION_KEYS",
      });
    }
  })
  .transform((v) => ({
    tokenEncryptionKeys: v.TOKEN_ENCRYPTION_KEYS,
    activeKeyId: v.TOKEN_ENCRYPTION_ACTIVE_KEY,
    oauthStateSecret: v.OAUTH_STATE_SECRET,
  }));

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

export const observabilitySchema = z
  .object({
    SENTRY_DSN: httpsUrl.optional(),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  })
  .transform((v) => ({ sentryDsn: v.SENTRY_DSN, logLevel: v.LOG_LEVEL }));

export const e2eSchema = z
  .object({ E2E_TEST_AUTH_SECRET: z.string().min(32).optional() })
  .transform((v) => ({ testAuthSecret: v.E2E_TEST_AUTH_SECRET }));

/** Seed script only (M0-11): comma-separated owner emails, stored lower-case. */
export const seedSchema = z
  .object({
    SEED_OWNER_EMAILS: z
      .string()
      .transform((raw) =>
        raw
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      )
      .pipe(z.array(z.email()).min(1, "Expected at least one email")),
  })
  .transform((v) => ({ ownerEmails: v.SEED_OWNER_EMAILS }));

/** Defaults for the mode flags; production guards reject the unsafe ones. */
export const FLAG_DEFAULTS = {
  JOBS_MODE: "inline",
  AI_PROVIDER: "live",
  STORAGE_PROVIDER: "r2",
  INSTAGRAM_PUBLISH_MODE: "off",
} as const;
