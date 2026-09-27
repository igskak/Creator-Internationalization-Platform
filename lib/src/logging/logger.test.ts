import { describe, expect, it } from "vitest";
import { childLogger, createLogger } from "./index";

// Every value that must never appear in log output.
const SECRETS = [
  "IGQV-long-lived-token",
  "AQB-oauth-code-123",
  "shh-client-secret",
  "presig-signature-abc",
  "AKIA-credential-xyz",
  "sb-access-token-cookie",
  "db-password-456",
  "sk-ant-key-789",
  "bearer-in-error",
  "config-header-secret",
  "binding-token",
];

function capture() {
  const lines: string[] = [];
  const logger = createLogger({
    service: "jobs",
    env: "test",
    release: "abc123",
    level: "debug",
    destination: { write: (line: string) => void lines.push(line) },
  });
  const output = () => lines.join("");
  const records = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, output, records };
}

function expectNoSecrets(output: string) {
  for (const secret of SECRETS) expect(output).not.toContain(secret);
}

describe("createLogger", () => {
  it("writes JSON with ts, level label, service, env and release", () => {
    const { logger, records } = capture();
    logger.info({ durationMs: 12 }, "rendered");
    const [record] = records();
    expect(record).toMatchObject({
      level: "info",
      service: "jobs",
      env: "test",
      release: "abc123",
      durationMs: 12,
      msg: "rendered",
    });
    expect(typeof record?.ts).toBe("string");
  });

  it("redacts tokens, codes, secrets, cookies and API keys in log objects", () => {
    const { logger, output } = capture();
    logger.info(
      {
        instagram: { accessToken: "IGQV-long-lived-token", oauth: { code: "AQB-oauth-code-123" } },
        app: { client_secret: "shh-client-secret" },
        request: { headers: { cookie: "sb-access-token-cookie", "x-api-key": "sk-ant-key-789" } },
        usage: { inputTokens: 1500 },
      },
      "exchange done",
    );
    expectNoSecrets(output());
    expect(output()).toContain('"inputTokens":1500');
  });

  it("scrubs presigned URLs and connection strings in fields and messages", () => {
    const { logger, output } = capture();
    const presigned =
      "https://acc.r2.cloudflarestorage.com/b/renders/1.jpg?X-Amz-Credential=AKIA-credential-xyz&X-Amz-Signature=presig-signature-abc";
    logger.info({ imageUrl: presigned }, `media container created from ${presigned}`);
    logger.warn(`db slow: postgresql://postgres:db-password-456@db.example.com:5432/postgres`);
    expectNoSecrets(output());
    expect(output()).toContain("https://acc.r2.cloudflarestorage.com/b/renders/1.jpg?");
  });

  it("serializes errors without request configs, headers or secrets in the message", () => {
    const { logger, records, output } = capture();
    const error = Object.assign(
      new Error("401 for https://graph.instagram.com/me?access_token=IGQV-long-lived-token"),
      {
        code: "OAuthException",
        config: { headers: { Authorization: "Bearer config-header-secret" } },
      },
    );
    logger.error(error);
    logger.error({ err: new Error("Authorization: Bearer bearer-in-error") }, "publish failed");
    expectNoSecrets(output());
    const [first] = records();
    expect(first?.err).toMatchObject({ name: "Error", code: "OAuthException" });
    expect(first?.err).not.toHaveProperty("config");
  });

  it("redacts child logger bindings and keeps correlation context", () => {
    const { logger, records, output } = capture();
    const child = childLogger(logger, { requestId: "req-42", market: "es-ES" });
    child.child({ token: "binding-token" }).info("step");
    expectNoSecrets(output());
    expect(records()[0]).toMatchObject({
      requestId: "req-42",
      market: "es-ES",
      token: "[REDACTED]",
    });
  });
});
