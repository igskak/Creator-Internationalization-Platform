import { describe, expect, it } from "vitest";
import { isSensitiveKey, REDACTED, redact, serializeError } from "./index";

describe("isSensitiveKey", () => {
  it.each([
    "access_token",
    "accessToken",
    "refresh_token",
    "token",
    "client_secret",
    "authorization",
    "Authorization",
    "cookie",
    "set-cookie",
    "password",
    "apiKey",
    "x-api-key",
    "code",
    "signed_request",
    "secretAccessKey",
  ])("%s is sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["requestId", "market", "durationMs", "status", "errorCode", "mediaId"])(
    "%s is not sensitive",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe("redact", () => {
  it("replaces sensitive values at any depth and keeps the rest", () => {
    const input = {
      requestId: "req-1",
      account: {
        igUserId: "1784",
        credentials: { access_token: "IGQV-secret", expiresIn: 5184000 },
      },
      oauth: { code: "AQB-oauth-code", state: "st" },
      headers: {
        Authorization: "Bearer x",
        cookie: "sb-access-token=abc",
        "set-cookie": ["a=1", "b=2"],
      },
      usage: { inputTokens: 1200, outputTokens: 300 },
    };
    expect(redact(input)).toEqual({
      requestId: "req-1",
      account: { igUserId: "1784", credentials: REDACTED },
      oauth: { code: REDACTED, state: "st" },
      headers: { Authorization: REDACTED, cookie: REDACTED, "set-cookie": REDACTED },
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
  });

  it("does not modify the input", () => {
    const input = { token: "t", nested: { password: "p" } };
    redact(input);
    expect(input).toEqual({ token: "t", nested: { password: "p" } });
  });

  it("scrubs URLs in string values and arrays", () => {
    const out = redact({
      urls: ["https://x.test/a?X-Amz-Signature=sig-1&v=1"],
      note: "Bearer tok-2",
    });
    expect(JSON.stringify(out)).not.toMatch(/sig-1|tok-2/);
  });

  it("handles cycles, deep nesting and binary data", () => {
    const cyclic: Record<string, unknown> = { name: "a" };
    cyclic.self = cyclic;
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i++) deep = { deep };
    const out = redact({
      cyclic,
      deep,
      data: new Uint8Array(32),
      blob: Buffer.from("raw"),
    }) as Record<string, unknown>;
    expect(out.cyclic).toEqual({ name: "a", self: "[Circular]" });
    expect(JSON.stringify(out.deep)).toContain("[Truncated]");
    expect(out.data).toBe("[Binary 32 bytes]");
    expect(out.blob).toBe("[Binary 3 bytes]");
  });
});

describe("serializeError", () => {
  it("keeps name, message, code, status and cause; drops request config and headers", () => {
    const cause = new Error("socket hang up");
    const error = Object.assign(
      new Error("GET https://graph.instagram.com/me?access_token=err-token failed", { cause }),
      {
        name: "GraphError",
        code: "OAuthException",
        status: 400,
        config: { headers: { Authorization: "Bearer config-secret" } },
        response: { data: { access_token: "response-secret" } },
      },
    );
    const out = serializeError(error);
    expect(out).toMatchObject({
      name: "GraphError",
      message: "GET https://graph.instagram.com/me?access_token=[REDACTED] failed",
      code: "OAuthException",
      status: 400,
      cause: { name: "Error", message: "socket hang up" },
    });
    expect(Object.keys(out).sort()).toEqual([
      "cause",
      "code",
      "message",
      "name",
      "stack",
      "status",
    ]);
    expect(JSON.stringify(out)).not.toMatch(/err-token|config-secret|response-secret/);
  });

  it("serializes thrown non-errors without secrets", () => {
    expect(serializeError({ token: "thrown-secret", reason: "x" })).toEqual({
      name: "NonError",
      message: '{"token":"[REDACTED]","reason":"x"}',
    });
  });
});
