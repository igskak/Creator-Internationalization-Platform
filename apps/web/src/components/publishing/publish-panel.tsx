"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  type MarketInfo,
  PostButton,
  ScheduleButton,
} from "@/components/calendar/calendar-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import type { VariantPublicationsDto } from "@/lib/publication-dto";
import { cn } from "@/lib/utils";
import { retryPublication, schedulePublication } from "@/server/actions/publishing";
import { PublicationDrawer } from "./publication-drawer";

/** Draft statuses for which the panel has something to say. */
export const PUBLISHABLE_STATUSES = ["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED"];

const WATCH_EVERY_MS = 5000;

/**
 * The "Publishing" panel of a draft on the review screen (plan 10 §10.3, M5-09): where the post
 * stands, and for owners and editors Publish now / Schedule / Dry run / Retry, with the details
 * drawer (every call made, a readable error and what to do about it).
 */
export function PublishPanel({
  variantId,
  ideaId,
  title,
  variantStatus,
  market,
  canManage,
  publications,
}: {
  variantId: string;
  ideaId: string;
  title: string;
  variantStatus: string;
  market: MarketInfo;
  canManage: boolean;
  publications: VariantPublicationsDto;
}) {
  const { locale, messages } = useI18n();
  const t = messages.publish.panel;
  const errors = messages.publish.errors as Record<string, { title: string; next: string }>;
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [drawer, setDrawer] = useState<string | null>(null);
  const { current, lastDryRun } = publications;

  // While a post is going out, the page follows it.
  useEffect(() => {
    if (variantStatus !== "PUBLISHING") return;
    const timer = setInterval(() => router.refresh(), WATCH_EVERY_MS);
    return () => clearInterval(timer);
  }, [variantStatus, router]);

  const publishNow = useAction(schedulePublication, {
    toastOnError: false,
    onSuccess: (data) => {
      setConfirming(false);
      toast.success(t.publishQueued);
      setDrawer(data.publicationId);
      router.refresh();
    },
  });
  const dryRun = useAction(schedulePublication, {
    onSuccess: (data) => {
      toast.success(t.dryRunQueued);
      setDrawer(data.publicationId);
      router.refresh();
    },
  });
  const retry = useAction(retryPublication, {
    successMessage: t.retryQueued,
    onSuccess: () => router.refresh(),
  });

  const when = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: market.timeZone,
        }).format(new Date(iso))
      : "";
  const statusLine =
    current && current.status in t.status
      ? format((t.status as Record<string, string>)[current.status] ?? "", {
          time: when(current.status === "PUBLISHED" ? current.publishedAt : current.scheduledAt),
        })
      : ((t.status as Record<string, string>)[variantStatus] ?? variantStatus);
  const failure = current?.status === "FAILED" ? current.error : null;
  const words = failure ? (errors[failure.kind] ?? errors[failure.classification]) : undefined;
  const canDryRun = canManage && (variantStatus === "APPROVED" || variantStatus === "SCHEDULED");
  const live = current && ["SCHEDULED", "QUEUED"].includes(current.status) ? current : null;

  return (
    <section
      aria-label={t.title}
      className="flex flex-col gap-2 rounded-lg border p-3"
      data-testid="publish-panel"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t.title}
        </h3>
        <Badge
          variant="ghost"
          className={cn(
            variantStatus === "FAILED" &&
              "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
            variantStatus === "PUBLISHED" &&
              "bg-green-200 text-green-950 dark:bg-green-950 dark:text-green-200",
          )}
        >
          {statusLine}
        </Badge>
      </header>

      {failure ? (
        <div role="alert" className="rounded-md bg-red-50 p-2 text-sm dark:bg-red-950/40">
          <p className="font-medium">{words?.title ?? failure.message}</p>
          {words ? <p className="text-muted-foreground">{words.next}</p> : null}
        </div>
      ) : null}

      {lastDryRun ? (
        <p className="text-xs text-muted-foreground">
          {format(t.lastDryRun, {
            status: (t.dryStatus as Record<string, string>)[lastDryRun.status] ?? lastDryRun.status,
          })}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canManage && variantStatus === "APPROVED" ? (
          <>
            <Button size="sm" onClick={() => setConfirming(true)}>
              {t.publishNow}
            </Button>
            <ScheduleButton variantId={variantId} title={title} market={market} canSchedule>
              {t.schedule}
            </ScheduleButton>
          </>
        ) : null}
        {canManage && variantStatus === "FAILED" && current ? (
          <Button
            size="sm"
            disabled={retry.pending}
            onClick={() => void retry.run({ publicationId: current.id })}
          >
            {t.retry}
          </Button>
        ) : null}
        {canManage && live?.status === "SCHEDULED" && live.scheduledAt ? (
          <PostButton
            className={buttonVariants({ variant: "outline", size: "sm" })}
            canSchedule
            post={{
              publicationId: live.id,
              variantId,
              ideaId,
              title,
              market,
              at: live.scheduledAt,
              status: live.status,
              warnings: [],
              permalink: null,
            }}
          >
            {t.moveOrCancel}
          </PostButton>
        ) : null}
        {canDryRun ? (
          <Button
            size="sm"
            variant="outline"
            disabled={dryRun.pending}
            onClick={() => void dryRun.run({ variantId, mode: "IMMEDIATE", dryRun: true })}
          >
            {t.dryRun}
          </Button>
        ) : null}
        {current ? (
          <Button size="sm" variant="ghost" onClick={() => setDrawer(current.id)}>
            {t.details}
          </Button>
        ) : lastDryRun ? (
          <Button size="sm" variant="ghost" onClick={() => setDrawer(lastDryRun.id)}>
            {t.details}
          </Button>
        ) : null}
        {current?.permalink ? (
          <a
            href={current.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {messages.publish.drawer.openPost}
          </a>
        ) : null}
      </div>
      {!canManage && ["APPROVED", "FAILED"].includes(variantStatus) ? (
        <p className="text-xs text-muted-foreground">{t.readOnly}</p>
      ) : null}
      {canDryRun ? <p className="text-xs text-muted-foreground">{t.hint}</p> : null}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.publishNowTitle}</DialogTitle>
            <DialogDescription>
              {format(t.publishNowDescription, { market: market.name })}
            </DialogDescription>
          </DialogHeader>
          {publishNow.error ? (
            <p role="alert" className="text-sm text-destructive">
              {publishNow.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t.cancel}
            </Button>
            <Button
              disabled={publishNow.pending}
              onClick={() => void publishNow.run({ variantId, mode: "IMMEDIATE" })}
            >
              {t.publishNowConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {drawer ? (
        <PublicationDrawer
          publicationId={drawer}
          open
          onOpenChange={(open) => !open && setDrawer(null)}
          canManage={canManage}
        />
      ) : null}
    </section>
  );
}
