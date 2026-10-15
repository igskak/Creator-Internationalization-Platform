import { scrubSentryEvent, sentryDataCollection } from "@rc/lib/observability";
import type { JobEnvelope } from "@rc/modules/core";
import * as Sentry from "@sentry/node";
import { jobEnv } from "./runtime";

/**
 * Sentry for Trigger.dev workers (plan 12 §12.9): release = git SHA (APP_RELEASE), environment =
 * APP_ENV, scrubbed events. `defaultIntegrations: false` avoids clashing with Trigger.dev's own
 * OpenTelemetry instrumentation. No DSN → off.
 */
export function initJobSentry(): void {
  const env = jobEnv();
  Sentry.init({
    dsn: env.observability.sentryDsn,
    environment: env.appEnv,
    ...(env.observability.release ? { release: env.observability.release } : {}),
    defaultIntegrations: false,
    dataCollection: sentryDataCollection(),
    tracesSampleRate: 0,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

export type FailureContext = { taskId: string; runId: string; payload: unknown };

/** Tags for a failed run; the payload itself is never sent (only its request id). */
export function failureTags({ taskId, runId, payload }: FailureContext): Record<string, string> {
  const requestId = (payload as Partial<JobEnvelope> | undefined)?.meta?.requestId;
  return { task_id: taskId, run_id: runId, ...(requestId ? { request_id: requestId } : {}) };
}

/** Called once per run after the last attempt failed (tasks.onFailure). */
export function reportJobFailure(error: unknown, context: FailureContext): void {
  Sentry.captureException(error, { tags: failureTags(context) });
}

/**
 * An AI budget alert (H-05): one Sentry issue per month and level, so the "new issue" alert rule
 * e-mails the owner once. Only sums go out, no content.
 */
export function reportBudgetAlert(result: unknown): void {
  const alert = (
    result as {
      alert?: { level: string; month: string; monthToDateUsd: number; budgetUsd: number } | null;
    }
  )?.alert;
  if (!alert) return;
  Sentry.captureMessage(
    `AI cost ${alert.level === "RED" ? "is over" : "has reached 80 % of"} the monthly budget: $${alert.monthToDateUsd.toFixed(2)} of $${alert.budgetUsd.toFixed(2)} (${alert.month})`,
    {
      level: alert.level === "RED" ? "error" : "warning",
      fingerprint: ["ai-budget", alert.month, alert.level],
      tags: { alert: "ai_budget", level: alert.level, month: alert.month },
    },
  );
}
