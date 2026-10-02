import { describe, expect, it } from "vitest";
import { type ScrubbableEvent, scrubSentryEvent } from "./index";

const SECRETS = [
  "IGQV-token-1",
  "AQB-oauth-code",
  "sig-presigned",
  "AKIA-cred",
  "sb-cookie-value",
  "Bearer-secret",
  "db-pass",
  "e2e-secret-value",
  "frame-token",
  "crumb-token",
  "extra-api-key",
  "owner@example.com",
  "10.0.0.1",
];

describe("scrubSentryEvent", () => {
  it("removes every secret from a realistic server error event", () => {
    const event = scrubSentryEvent<ScrubbableEvent>({
      message: "GET https://graph.instagram.com/me?access_token=IGQV-token-1 failed",
      transaction: "GET /api/instagram/oauth/callback?code=AQB-oauth-code",
      request: {
        url: "https://app.example.com/api/instagram/oauth/callback?code=AQB-oauth-code&state=s1",
        query_string: "code=AQB-oauth-code&state=s1",
        headers: {
          "x-request-id": "req-123",
          cookie: "sb-access-token=sb-cookie-value",
          authorization: "Bearer Bearer-secret",
          "x-e2e-secret": "e2e-secret-value",
          "user-agent": "Mozilla/5.0",
        },
        cookies: { "sb-access-token": "sb-cookie-value" },
        data: { password: "db-pass", note: "ok" },
      },
      exception: {
        values: [
          {
            value:
              "fetch https://acc.r2.cloudflarestorage.com/b/k?X-Amz-Credential=AKIA-cred&X-Amz-Signature=sig-presigned",
            stacktrace: { frames: [{ vars: { accessToken: "frame-token", count: 3 } }] },
          },
        ],
      },
      breadcrumbs: [
        { message: "postgresql://u:db-pass@db.example.com/x", data: { token: "crumb-token" } },
      ],
      extra: { apiKey: "extra-api-key", entityId: "e1" },
      user: { id: "user-1", email: "owner@example.com", ip_address: "10.0.0.1" },
    });

    const json = JSON.stringify(event);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    expect(event.tags).toEqual({ request_id: "req-123" });
    expect(event.request?.headers).toEqual({
      "x-request-id": "req-123",
      "user-agent": "Mozilla/5.0",
    });
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.query_string).toBe("code=[REDACTED]&state=s1");
    expect(event.user).toEqual({ id: "user-1" });
    expect(event.extra).toEqual({ apiKey: "[REDACTED]", entityId: "e1" });
    expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toEqual({
      accessToken: "[REDACTED]",
      count: 3,
    });
  });

  it("keeps harmless events as they are", () => {
    const event = scrubSentryEvent({ message: "Rendered 8 slides", tags: { market: "es-ES" } });
    expect(event).toEqual({ message: "Rendered 8 slides", tags: { market: "es-ES" } });
  });

  it("drops the user entirely when there is no id", () => {
    expect(scrubSentryEvent({ user: { email: "owner@example.com" } }).user).toEqual({});
  });
});
