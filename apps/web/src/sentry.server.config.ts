import { scrubSentryEvent, sentryDataCollection } from "@rc/lib/observability";
import * as Sentry from "@sentry/nextjs";
import { serverEnv } from "./server/runtime";

// Server-side Sentry (plan 12 §12.9): release = git SHA, environment = APP_ENV, every event
// scrubbed (tokens, OAuth codes, presigned URLs, cookies), request id copied into a tag.
// No DSN (local dev, CI) → Sentry stays off.
const env = serverEnv();

Sentry.init({
  dsn: env.observability.sentryDsn,
  environment: env.appEnv,
  ...(env.observability.release ? { release: env.observability.release } : {}),
  dataCollection: sentryDataCollection(),
  tracesSampleRate: 0,
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
});
