import { describe, expect, it, vi } from "vitest";
import { isPublicPath, isTestLoginAllowed, requestMagicLinkFor, safeNextPath } from "./rules";

describe("isPublicPath", () => {
  it.each(["/login", "/auth/confirm", "/auth/sign-out", "/api/health", "/api/meta/deauthorize"])(
    "%s is public",
    (path) => expect(isPublicPath(path)).toBe(true),
  );
  it.each([
    "/",
    "/content/ideas",
    "/loginx",
    "/api/preview/slide",
    "/settings/brand",
    "/api/healthz",
  ])("%s needs a session", (path) => expect(isPublicPath(path)).toBe(false));
});

describe("safeNextPath", () => {
  it.each([
    ["/content/review/42?tab=es", "/content/review/42?tab=es"],
    [null, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example/x", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
  ])("%j → %j", (input, expected) => expect(safeNextPath(input)).toBe(expected));
});

describe("isTestLoginAllowed", () => {
  const secret = "e".repeat(32);
  it("allows the exact secret outside production", () => {
    expect(
      isTestLoginAllowed({ appEnv: "test", configuredSecret: secret, providedSecret: secret }),
    ).toBe(true);
  });
  it.each([
    { appEnv: "production", configuredSecret: secret, providedSecret: secret },
    { appEnv: "test", configuredSecret: undefined, providedSecret: secret },
    { appEnv: "test", configuredSecret: secret, providedSecret: null },
    { appEnv: "development", configuredSecret: secret, providedSecret: `${secret}x` },
  ])("refuses %j", (input) => expect(isTestLoginAllowed(input)).toBe(false));
});

describe("requestMagicLinkFor", () => {
  it("sends to allowlisted emails, normalized", async () => {
    const send = vi.fn(async () => {});
    const result = await requestMagicLinkFor(" Chef@Example.com ", {
      isAllowed: async () => true,
      send,
    });
    expect(result).toEqual({ sent: true, delivered: true });
    expect(send).toHaveBeenCalledWith("chef@example.com");
  });

  it("reports sent but sends nothing for unknown emails", async () => {
    const send = vi.fn(async () => {});
    const result = await requestMagicLinkFor("stranger@example.com", {
      isAllowed: async () => false,
      send,
    });
    expect(result).toEqual({ sent: true, delivered: false });
    expect(send).not.toHaveBeenCalled();
  });
});
