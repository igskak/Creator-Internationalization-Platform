import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

describe("securityHeaders", () => {
  it("sets the headers from plan 12 §12.5", () => {
    const headers = Object.fromEntries(
      securityHeaders({ dev: false }).map((h) => [h.key, h.value]),
    );
    expect(headers["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Content-Security-Policy"]).toBeDefined();
  });

  it("forbids framing and allows only Supabase and R2 as external hosts", () => {
    const csp = contentSecurityPolicy({ dev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toMatch(
      /connect-src 'self' https:\/\/\*\.supabase\.co .*https:\/\/\*\.r2\.cloudflarestorage\.com/,
    );
    expect(csp).toMatch(/img-src 'self' data: blob: https:\/\/\*\.r2\.cloudflarestorage\.com/);
  });

  it("lets the browser report errors to Sentry ingest", () => {
    expect(contentSecurityPolicy({ dev: false })).toContain("https://*.ingest.de.sentry.io");
  });

  it("allows eval only in development", () => {
    expect(contentSecurityPolicy({ dev: false })).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy({ dev: true })).toContain("'unsafe-eval'");
  });
});
