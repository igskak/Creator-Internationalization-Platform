// Security headers for every response (plan 12 §12.5). Hosts are wildcards so the build does not
// need env: Supabase (auth), R2 (presigned uploads and images) and Sentry ingest. Next.js injects inline scripts
// for hydration, so script-src needs 'unsafe-inline' until a nonce-based CSP is added.

export type Header = { key: string; value: string };

export function contentSecurityPolicy({ dev }: { dev: boolean }): string {
  const supabase = "https://*.supabase.co wss://*.supabase.co";
  const r2 = "https://*.r2.cloudflarestorage.com";
  // Browser error reports (Sentry ingest, US and EU regions).
  const sentry =
    "https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io";
  const directives: Record<string, string> = {
    "default-src": "'self'",
    "script-src": `'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src": "'self' 'unsafe-inline'",
    "img-src": `'self' data: blob: ${r2}`,
    "font-src": "'self' data:",
    "connect-src": `'self' ${supabase} ${r2} ${sentry}`,
    "frame-src": "'self'",
    "frame-ancestors": "'none'",
    "form-action": "'self'",
    "base-uri": "'self'",
    "object-src": "'none'",
  };
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join("; ");
}

export function securityHeaders({ dev }: { dev: boolean }): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy({ dev }) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}
