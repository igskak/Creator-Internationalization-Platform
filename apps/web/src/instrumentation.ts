import { installConsoleScrubber } from "@rc/lib/observability";
import * as Sentry from "@sentry/nextjs";

// Next.js instrumentation hook (Sentry for Next.js 15+/16). The app runs on the Node.js runtime
// only (proxy.ts included, V-21), so there is no edge config.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Next.js prints unhandled errors with console.error; strip tokens from them (12 §12.7).
    installConsoleScrubber();
    await import("./sentry.server.config");
  }
}

/**
 * Errors thrown in server components, route handlers and server actions. Drizzle wraps a database
 * error in "Failed query: …" and the Vercel log shows only that, so the wrapped error's code and
 * message (never its parameters) are logged as well.
 */
export const onRequestError: typeof Sentry.captureRequestError = (error, ...rest) => {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  if (cause && typeof cause === "object") {
    console.error(
      `request error cause: ${String(cause.code ?? "")} ${String(cause.message ?? "")}`,
    );
  }
  return Sentry.captureRequestError(error, ...rest);
};
