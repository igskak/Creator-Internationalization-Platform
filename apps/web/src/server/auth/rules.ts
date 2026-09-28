import { safeEqual } from "@rc/lib/security";

// Pure auth rules, unit-tested (plan 12 §12.5). No Next.js or Supabase imports here.

/** Paths reachable without a session. Everything else needs one (pages redirect, APIs get 401). */
const PUBLIC_PREFIXES = ["/login", "/auth/", "/api/health", "/api/meta/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) =>
    prefix.endsWith("/")
      ? pathname.startsWith(prefix)
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Only same-site relative paths; anything else (//evil.com, https://…, /\evil) becomes "/". */
export function safeNextPath(next: string | null | undefined): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  try {
    const url = new URL(next, "http://internal.invalid");
    return url.origin === "http://internal.invalid" ? `${url.pathname}${url.search}` : "/";
  } catch {
    return "/";
  }
}

/**
 * The E2E test-login route works only outside production, only when E2E_TEST_AUTH_SECRET is set,
 * and only with that exact secret (constant-time compare).
 */
export function isTestLoginAllowed(input: {
  appEnv: string;
  configuredSecret: string | undefined;
  providedSecret: string | null | undefined;
}): boolean {
  if (input.appEnv === "production") return false;
  if (!input.configuredSecret || !input.providedSecret) return false;
  return safeEqual(input.configuredSecret, input.providedSecret);
}

/**
 * Magic link request (05 §5.2): always reports `sent` so the response does not reveal which
 * emails are allowlisted; sends only to active app users.
 */
export async function requestMagicLinkFor(
  email: string,
  deps: { isAllowed: (email: string) => Promise<boolean>; send: (email: string) => Promise<void> },
): Promise<{ sent: true; delivered: boolean }> {
  const normalized = email.trim().toLowerCase();
  if (!(await deps.isAllowed(normalized))) return { sent: true, delivered: false };
  await deps.send(normalized);
  return { sent: true, delivered: true };
}
