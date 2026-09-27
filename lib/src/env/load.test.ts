import { describe, expect, it } from "vitest";
import { EnvValidationError, loadDbEnv, loadServerEnv } from "./load";

const key = (fill: number) => Buffer.alloc(32, fill).toString("base64");

// Synthetic values only.
const base = {
  DATABASE_URL: "postgresql://postgres:pw@localhost:5432/regchef",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  TOKEN_ENCRYPTION_KEYS: `v1:${key(1)}`,
  TOKEN_ENCRYPTION_ACTIVE_KEY: "v1",
  OAUTH_STATE_SECRET: "s".repeat(32),
  STORAGE_PROVIDER: "memory",
  AI_PROVIDER: "fake",
};

const production = {
  ...base,
  APP_ENV: "production",
  JOBS_MODE: "trigger",
  TRIGGER_SECRET_KEY: "tr_prod_secret",
  AI_PROVIDER: "live",
  ANTHROPIC_API_KEY: "sk-ant-secret",
  OPENAI_API_KEY: "sk-openai-secret",
  STORAGE_PROVIDER: "r2",
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "r2-secret-value",
  R2_BUCKET: "regchef-prod",
};

function problemsOf(source: Record<string, string | undefined>) {
  try {
    loadServerEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error("expected EnvValidationError");
}

describe("loadServerEnv: valid", () => {
  it("parses a minimal development env and applies defaults", () => {
    const env = loadServerEnv(base);
    expect(env.appEnv).toBe("development");
    expect(env.db).toEqual({ url: base.DATABASE_URL, directUrl: undefined });
    expect(env.jobs).toEqual({ mode: "inline" });
    expect(env.ai).toEqual({ provider: "fake" });
    expect(env.storage).toEqual({ provider: "memory" });
    expect(env.instagram).toEqual({ publishMode: "off" });
    expect(env.observability.logLevel).toBe("info");
    expect(env.security.activeKeyId).toBe("v1");
    expect(env.security.tokenEncryptionKeys.get("v1")).toEqual(new Uint8Array(32).fill(1));
  });

  it("parses a full production env", () => {
    const env = loadServerEnv({
      ...production,
      TOKEN_ENCRYPTION_KEYS: `v1:${key(1)}, v2:${key(2)}`,
      TOKEN_ENCRYPTION_ACTIVE_KEY: "v2",
      INSTAGRAM_PUBLISH_MODE: "live",
      IG_APP_ID: "123",
      IG_APP_SECRET: "ig-secret",
      IG_REDIRECT_URI: "https://app.example.com/api/instagram/oauth/callback",
      META_GRAPH_API_VERSION: "v24.0",
      INSTAGRAM_ACCOUNT_ALLOWLIST: " 1784, 1785 ,",
    });
    expect(env.appEnv).toBe("production");
    expect(env.jobs).toEqual({ mode: "trigger", triggerSecretKey: "tr_prod_secret" });
    expect(env.storage).toMatchObject({ provider: "r2", bucket: "regchef-prod" });
    expect(env.instagram).toMatchObject({
      publishMode: "live",
      graphBaseUrl: "https://graph.instagram.com",
      accountAllowlist: ["1784", "1785"],
    });
    expect([...env.security.tokenEncryptionKeys.keys()]).toEqual(["v1", "v2"]);
  });

  it("treats empty values as unset", () => {
    const env = loadServerEnv({ ...base, DATABASE_URL_DIRECT: "", LOG_LEVEL: " " });
    expect(env.db.directUrl).toBeUndefined();
    expect(env.observability.logLevel).toBe("info");
  });
});

describe("loadServerEnv: invalid", () => {
  it("lists every missing variable by name", () => {
    const error = problemsOf({ AI_PROVIDER: "live", STORAGE_PROVIDER: "r2" });
    const missing = error.problems.filter((p) => p.kind === "missing").map((p) => p.name);
    expect(missing).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "R2_ACCOUNT_ID",
        "R2_BUCKET",
        "TOKEN_ENCRYPTION_KEYS",
        "OAUTH_STATE_SECRET",
      ]),
    );
  });

  it("requires mode-specific variables only for that mode", () => {
    const error = problemsOf({
      ...base,
      JOBS_MODE: "trigger",
      INSTAGRAM_PUBLISH_MODE: "dry_run_only",
    });
    expect(error.problems.map((p) => p.name).sort()).toEqual([
      "IG_APP_ID",
      "IG_APP_SECRET",
      "IG_REDIRECT_URI",
      "META_GRAPH_API_VERSION",
      "TRIGGER_SECRET_KEY",
    ]);
  });

  it("reports invalid values without printing them", () => {
    const error = problemsOf({
      ...base,
      DATABASE_URL: "mysql://user:hunter2-password@db/regchef",
      OAUTH_STATE_SECRET: "short-secret-value",
      JOBS_MODE: "cron",
      TOKEN_ENCRYPTION_KEYS: "v1:bm90LTMyLWJ5dGVz",
    });
    expect(error.problems.map((p) => [p.name, p.kind])).toEqual(
      expect.arrayContaining([
        ["DATABASE_URL", "invalid"],
        ["OAUTH_STATE_SECRET", "invalid"],
        ["JOBS_MODE", "invalid"],
        ["TOKEN_ENCRYPTION_KEYS", "invalid"],
      ]),
    );
    for (const value of ["hunter2-password", "short-secret-value", "bm90LTMyLWJ5dGVz", "cron"]) {
      expect(error.message).not.toContain(value);
    }
  });

  it("rejects an active key id that is not in the key ring", () => {
    const error = problemsOf({ ...base, TOKEN_ENCRYPTION_ACTIVE_KEY: "v2" });
    expect(error.problems).toEqual([
      expect.objectContaining({ name: "TOKEN_ENCRYPTION_ACTIVE_KEY", kind: "invalid" }),
    ]);
  });

  it("rejects duplicate key ids", () => {
    const error = problemsOf({ ...base, TOKEN_ENCRYPTION_KEYS: `v1:${key(1)},v1:${key(2)}` });
    expect(error.problems.map((p) => p.name)).toContain("TOKEN_ENCRYPTION_KEYS");
  });
});

describe("loadServerEnv: production guards", () => {
  it("accepts a production env with trigger jobs, live AI, R2 and no test secret", () => {
    expect(() => loadServerEnv(production)).not.toThrow();
  });

  it("refuses inline jobs, including the default", () => {
    const { JOBS_MODE: _mode, TRIGGER_SECRET_KEY: _key, ...withoutJobs } = production;
    for (const source of [{ ...production, JOBS_MODE: "inline" }, withoutJobs]) {
      expect(problemsOf(source).problems).toEqual([
        expect.objectContaining({ name: "JOBS_MODE", reason: 'must be "trigger" in production' }),
      ]);
    }
  });

  it("refuses the E2E test auth secret", () => {
    const error = problemsOf({ ...production, E2E_TEST_AUTH_SECRET: "e".repeat(32) });
    expect(error.problems).toEqual([
      expect.objectContaining({
        name: "E2E_TEST_AUTH_SECRET",
        reason: "must not be set in production",
      }),
    ]);
  });

  it("refuses fake AI and in-memory storage", () => {
    const error = problemsOf({ ...production, AI_PROVIDER: "fake", STORAGE_PROVIDER: "memory" });
    expect(error.problems.map((p) => p.name).sort()).toEqual(["AI_PROVIDER", "STORAGE_PROVIDER"]);
  });

  it("allows inline jobs and the test secret outside production", () => {
    expect(() =>
      loadServerEnv({ ...base, APP_ENV: "test", E2E_TEST_AUTH_SECRET: "e".repeat(32) }),
    ).not.toThrow();
  });
});

describe("loadDbEnv", () => {
  it("needs only the database variables", () => {
    expect(loadDbEnv({ DATABASE_URL: base.DATABASE_URL })).toEqual({
      url: base.DATABASE_URL,
      directUrl: undefined,
    });
  });

  it("reports a missing DATABASE_URL by name", () => {
    expect(() => loadDbEnv({})).toThrow(/DATABASE_URL: missing/);
  });
});
