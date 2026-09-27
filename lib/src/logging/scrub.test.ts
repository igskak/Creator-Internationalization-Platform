import { describe, expect, it } from "vitest";
import { scrubText, scrubUrl } from "./scrub";

describe("scrubUrl", () => {
  it("redacts Instagram tokens and OAuth codes, keeps the rest", () => {
    const url =
      "https://graph.instagram.com/v24.0/me/media?fields=id,caption&access_token=IGQVJtoken123&limit=5";
    expect(scrubUrl(url)).toBe(
      "https://graph.instagram.com/v24.0/me/media?fields=id,caption&access_token=[REDACTED]&limit=5",
    );
    expect(
      scrubUrl("https://app.example.com/api/instagram/oauth/callback?code=AQBx9-oauth#_&state=abc"),
    ).toBe("https://app.example.com/api/instagram/oauth/callback?code=[REDACTED]#_&state=abc");
  });

  it("redacts client secrets and signed requests", () => {
    const scrubbed = scrubUrl(
      "https://api.instagram.com/oauth/access_token?client_id=1&client_secret=shh-app-secret&signed_request=sig.payload",
    );
    expect(scrubbed).not.toContain("shh-app-secret");
    expect(scrubbed).not.toContain("sig.payload");
    expect(scrubbed).toContain("client_id=1");
  });

  it("redacts every X-Amz-* parameter of a presigned URL", () => {
    const presigned =
      "https://acc.r2.cloudflarestorage.com/regchef-dev/renders/a/1.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIAEXAMPLE%2F20260927%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260927T120000Z" +
      "&X-Amz-Expires=7200&X-Amz-SignedHeaders=host&X-Amz-Signature=deadbeefcafe";
    const scrubbed = scrubUrl(new URL(presigned));
    expect(scrubbed).toContain("https://acc.r2.cloudflarestorage.com/regchef-dev/renders/a/1.jpg?");
    for (const secret of ["AKIAEXAMPLE", "deadbeefcafe", "AWS4-HMAC-SHA256", "20260927T120000Z"]) {
      expect(scrubbed).not.toContain(secret);
    }
  });

  it("redacts passwords in connection strings", () => {
    expect(
      scrubUrl("postgresql://postgres.ref:db-pass-123@aws-0-eu.pooler.supabase.com:6543/postgres"),
    ).toBe("postgresql://postgres.ref:[REDACTED]@aws-0-eu.pooler.supabase.com:6543/postgres");
  });
});

describe("scrubText", () => {
  it("scrubs URLs inside free text and authorization credentials", () => {
    const text =
      "request to https://graph.instagram.com/me?access_token=tok-in-message failed; " +
      "headers: Authorization: Bearer sk-live-bearer, Proxy: Basic dXNlcjpwYXNz";
    const scrubbed = scrubText(text);
    for (const secret of ["tok-in-message", "sk-live-bearer", "dXNlcjpwYXNz"]) {
      expect(scrubbed).not.toContain(secret);
    }
    expect(scrubbed).toContain(
      "request to https://graph.instagram.com/me?access_token=[REDACTED] failed",
    );
  });

  it("leaves text without credentials unchanged", () => {
    const text =
      "Rendered 8 slides for es-ES in 1234 ms (https://app.example.com/content/review/42?tab=es)";
    expect(scrubText(text)).toBe(text);
  });
});
