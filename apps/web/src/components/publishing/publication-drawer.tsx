"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import type { PublicationDto } from "@/lib/publication-dto";
import { cn } from "@/lib/utils";
import { getPublication, retryPublication } from "@/server/actions/publishing";

const STATUS_STYLE: Record<string, string> = {
  SCHEDULED: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  QUEUED: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  IN_PROGRESS: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  PUBLISHED: "bg-green-200 text-green-950 dark:bg-green-950 dark:text-green-200",
  DRY_RUN_PASSED: "bg-green-200 text-green-950 dark:bg-green-950 dark:text-green-200",
  FAILED: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  CANCELLED: "bg-muted text-muted-foreground",
};
const OUTCOME_STYLE: Record<string, string> = {
  OK: "text-green-800 dark:text-green-300",
  TRANSIENT_ERROR: "text-amber-800 dark:text-amber-300",
  PERMANENT_ERROR: "text-destructive",
  AMBIGUOUS: "text-destructive",
};

/** The details of one publication (plan 10 §10.4): status, a readable error, and every call made. */
export function PublicationDrawer({
  publicationId,
  open,
  onOpenChange,
  canManage,
}: {
  publicationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}) {
  const { locale, messages } = useI18n();
  const t = messages.publish.drawer;
  const errors = messages.publish.errors as Record<string, { title: string; next: string }>;
  const router = useRouter();
  const [data, setData] = useState<PublicationDto | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useAction(getPublication, { toastOnError: false });
  const retry = useAction(retryPublication, {
    successMessage: t.retryQueued,
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
  });

  // Loaded each time the drawer opens, and again while the post is still moving.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `load.run` changes with every render
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const fetchOnce = async () => {
      const result = await load.run({ publicationId });
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        setFailed(false);
      } else setFailed(true);
    };
    void fetchOnce();
    const timer = setInterval(() => {
      if (data && ["QUEUED", "IN_PROGRESS"].includes(data.status)) void fetchOnce();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, publicationId]);

  const dateTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "medium",
          ...(data ? { timeZone: data.market.timezone } : {}),
        }).format(new Date(iso))
      : "—";
  const error = data?.error ?? null;
  const words = error ? (errors[error.kind] ?? errors[error.classification]) : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full overflow-y-auto p-4 sm:max-w-2xl"
        data-testid="publication-drawer"
      >
        <SheetHeader className="p-0">
          <SheetTitle>{t.title}</SheetTitle>
          <SheetDescription>
            {data
              ? format(t.description, {
                  market: data.market.name,
                  kind: data.dryRun ? t.kind.dry : t.kind.live,
                })
              : t.loading}
          </SheetDescription>
        </SheetHeader>

        {failed && !data ? (
          <p role="alert" className="text-sm text-destructive">
            {t.loadFailed}
          </p>
        ) : null}

        {data ? (
          <div className="flex flex-col gap-4">
            {data.title ? <p className="font-medium">{data.title}</p> : null}
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">{t.status}</dt>
              <dd>
                <Badge className={cn("border-0", STATUS_STYLE[data.status])}>
                  {(t.statusName as Record<string, string>)[data.status] ?? data.status}
                </Badge>
              </dd>
              {data.step ? (
                <>
                  <dt className="text-muted-foreground">{t.step}</dt>
                  <dd>{(t.steps as Record<string, string>)[data.step] ?? data.step}</dd>
                </>
              ) : null}
              {data.account ? (
                <>
                  <dt className="text-muted-foreground">{t.account}</dt>
                  <dd>@{data.account.username}</dd>
                </>
              ) : null}
              {data.scheduledAt ? (
                <>
                  <dt className="text-muted-foreground">{t.scheduled}</dt>
                  <dd>{dateTime(data.scheduledAt)}</dd>
                </>
              ) : null}
              {data.publishedAt ? (
                <>
                  <dt className="text-muted-foreground">{t.published}</dt>
                  <dd>{dateTime(data.publishedAt)}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">{t.created}</dt>
              <dd>{dateTime(data.createdAt)}</dd>
              <dt className="text-muted-foreground">{t.attempts}</dt>
              <dd>
                {data.attemptCount}
                {data.retryNo > 0 ? ` · ${t.retries}: ${data.retryNo}` : ""}
              </dd>
            </dl>

            {error ? (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-md bg-red-50 p-3 text-sm dark:bg-red-950/40"
                data-testid="publication-error"
              >
                <p className="font-medium">{t.problem}</p>
                <p>{words?.title ?? error.message}</p>
                <p className="font-medium">{t.nextStep}</p>
                <p>{words?.next ?? ""}</p>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">{t.technical}</summary>
                  <p className="mt-1 break-words">{error.message}</p>
                  <p>
                    {[
                      error.code !== null ? format(t.code, { code: error.code }) : null,
                      error.subcode !== null ? format(t.subcode, { subcode: error.subcode }) : null,
                      error.fbtraceId ? format(t.trace, { id: error.fbtraceId }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </details>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {canManage && data.canRetry ? (
                <Button
                  disabled={retry.pending}
                  onClick={() => void retry.run({ publicationId: data.id })}
                >
                  {t.retry}
                </Button>
              ) : null}
              <Link
                href={`/content/review/${data.ideaId}`}
                className={buttonVariants({ variant: "outline" })}
              >
                {t.openReview}
              </Link>
              {data.permalink ? (
                <a
                  href={data.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: "outline" })}
                >
                  {t.openPost}
                </a>
              ) : null}
            </div>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t.timeline}</h3>
              {data.attempts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noCalls}</p>
              ) : (
                <ol className="flex flex-col gap-1.5" data-testid="publication-timeline">
                  {data.attempts.map((call) => (
                    <li
                      key={call.id}
                      className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 rounded border p-2 text-xs"
                    >
                      <span className="tabular-nums text-muted-foreground">
                        {new Intl.DateTimeFormat(locale, {
                          timeStyle: "medium",
                          timeZone: data.market.timezone,
                        }).format(new Date(call.at))}
                      </span>
                      <span className="min-w-0 break-words">
                        <span className="font-medium">
                          {(t.steps as Record<string, string>)[call.step] ?? call.step}
                        </span>{" "}
                        <span className="font-mono text-muted-foreground">{call.endpoint}</span>
                        {call.errorCode ? (
                          <span className="text-destructive">
                            {" "}
                            · {format(t.code, { code: call.errorCode })}
                            {call.errorSubcode
                              ? ` / ${format(t.subcode, { subcode: call.errorSubcode })}`
                              : ""}
                          </span>
                        ) : null}
                      </span>
                      <span className={cn("text-right", OUTCOME_STYLE[call.outcome])}>
                        {(t.outcome as Record<string, string>)[call.outcome] ?? call.outcome}
                        {call.httpStatus ? ` · ${call.httpStatus}` : ""}
                        {call.durationMs !== null ? ` · ${call.durationMs} ms` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
