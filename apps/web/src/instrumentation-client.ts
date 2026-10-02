import { scrubSentryEvent, sentryDataCollection } from "@rc/lib/observability";
import * as Sentry from "@sentry/nextjs";

// Browser Sentry. The DSN is public by design; it is inlined at build time from
// NEXT_PUBLIC_SENTRY_DSN (unset → Sentry off). The release is injected by withSentryConfig.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
  dataCollection: sentryDataCollection(),
  tracesSampleRate: 0,
  beforeSend: (event) => scrubSentryEvent(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
