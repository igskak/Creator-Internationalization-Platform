"use client";

import type { DraftProgress } from "@rc/modules/content";
import { CheckIcon, CircleIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { isActive } from "@/lib/progress-model";
import { cn } from "@/lib/utils";
import { useDraftProgress } from "./progress-state";

// The steps of a draft being made (M6-10): a tick for a finished step, a spinner for the current
// one, muted for those to come, red for the one that failed; the time it has taken and the usual
// time; "taking longer than usual" with a way to look into it instead of spinning for ever.

type T = ReturnType<typeof useI18n>["messages"]["review"]["progress"];

/** "2 min 10 s" / "45 s": whole seconds under a minute, minutes and seconds up to ten, then minutes. */
export function formatDuration(ms: number, t: Pick<T, "minutes" | "seconds">): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return format(t.seconds, { n: seconds });
  if (minutes >= 10 || seconds === 0) return format(t.minutes, { n: minutes });
  return `${format(t.minutes, { n: minutes })} ${format(t.seconds, { n: seconds })}`;
}

/** The time now, ticking each second while `running`; null before the page is on the client. */
function useNow(running: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

const ICON = "size-4 shrink-0";

function StepIcon({ state }: { state: DraftProgress["steps"][number]["state"] }) {
  if (state === "done")
    return <CheckIcon aria-hidden="true" className={cn(ICON, "text-green-700")} />;
  if (state === "current") {
    return (
      <LoaderCircleIcon
        aria-hidden="true"
        className={cn(ICON, "animate-spin text-sky-700 motion-reduce:animate-none")}
      />
    );
  }
  if (state === "failed") return <XIcon aria-hidden="true" className={cn(ICON, "text-red-700")} />;
  return <CircleIcon aria-hidden="true" className={cn(ICON, "text-muted-foreground/50")} />;
}

/**
 * The progress of one draft, from the review page's provider. Shows nothing when the draft has
 * nothing running and nothing failed. `hideError` leaves out the error text when the page already
 * shows it.
 */
export function ProgressPanel({
  variantId,
  hideError = false,
  fallback = null,
}: {
  variantId: string;
  hideError?: boolean;
  /** Shown when the page has no progress for this draft (outside the page's provider). */
  fallback?: ReactNode;
}) {
  const found = useDraftProgress(variantId);
  if (!found) return <>{fallback}</>;
  return (
    <ProgressPanelView progress={found.progress} usualMs={found.usualMs} hideError={hideError} />
  );
}

/** The panel for given progress: the page's provider feeds it, and the dev preview shows it alone. */
export function ProgressPanelView({
  progress,
  usualMs,
  hideError = false,
}: {
  progress: DraftProgress;
  usualMs: number | null;
  hideError?: boolean;
}) {
  const t = useI18n().messages.review.progress;
  const active = isActive(progress);
  const now = useNow(active);
  if (progress.phase === "idle") return null;

  const failed = progress.phase === "failed";
  const elapsed =
    progress.startedAt && now !== null ? Math.max(0, now - Date.parse(progress.startedAt)) : null;
  const usual = usualMs;

  return (
    <section
      aria-label={failed ? t.titleStopped : t.title}
      data-testid="progress-panel"
      data-phase={progress.phase}
      data-stalled={progress.stalled ? "true" : undefined}
      className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3"
    >
      <h3 className="text-sm font-medium">{failed ? t.titleStopped : t.title}</h3>
      {progress.phase === "queued" ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t.queued}
        </p>
      ) : null}
      <ol className="flex flex-col gap-1.5 text-sm">
        {progress.steps.map((step) => (
          <li
            key={step.key}
            data-step={step.key}
            data-state={step.state}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              "flex items-center gap-2",
              step.state === "todo" && "text-muted-foreground",
              step.state === "done" && "text-muted-foreground",
              step.state === "current" && "font-medium",
              step.state === "failed" && "font-medium text-red-800 dark:text-red-300",
            )}
          >
            <StepIcon state={step.state} />
            <span>{t.steps[step.key]}</span>
            {step.count ? (
              <span className="tabular-nums text-muted-foreground">
                {format(t.pictures, step.count)}
              </span>
            ) : null}
            {step.rewrite ? (
              <span className="text-muted-foreground">
                {format(t.rewrite, { n: step.rewrite })}
              </span>
            ) : null}
            {step.state === "failed" ? <span className="text-xs">{t.failedHere}</span> : null}
          </li>
        ))}
      </ol>
      {active && elapsed !== null ? (
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="off">
          {format(t.elapsed, { time: formatDuration(elapsed, t) })}
          {usual ? ` · ${format(t.usual, { time: formatDuration(usual, t) })}` : ""}
        </p>
      ) : null}
      {failed && progress.error && !hideError ? (
        <p role="alert" className="text-sm">
          {progress.error.message}
        </p>
      ) : null}
      {progress.stalled || failed ? (
        <p className="text-xs text-muted-foreground">
          {progress.stalled ? (progress.phase === "queued" ? t.stalledQueued : t.stalled) : null}{" "}
          <Link href="/settings/health" className="underline underline-offset-4">
            {t.checkHealth}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
