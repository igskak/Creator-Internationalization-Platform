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

/** Errors thrown in server components, route handlers and server actions. */
export const onRequestError = Sentry.captureRequestError;
