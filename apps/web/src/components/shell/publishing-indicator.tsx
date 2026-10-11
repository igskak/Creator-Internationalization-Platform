"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/provider";
import type { PublishingIndicatorState } from "@/lib/publishing-indicator";
import { cn } from "@/lib/utils";

const STYLE: Record<PublishingIndicatorState, string> = {
  off: "bg-muted text-muted-foreground",
  paused: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200",
  dryRun: "bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-200",
  live: "bg-green-200 text-green-950 dark:bg-green-950 dark:text-green-200",
};

/** The header's small status of publishing; always visible, links to the switch. */
export function PublishingIndicator({ state }: { state: PublishingIndicatorState }) {
  const t = useI18n().messages.publishing.indicator;
  const title = {
    off: t.titleOff,
    paused: t.titlePaused,
    dryRun: t.titleDryRun,
    live: t.titleLive,
  }[state];
  return (
    <Link
      href="/settings/instagram"
      title={title}
      data-testid="publishing-indicator"
      data-state={state}
      className="rounded-md focus-visible:outline-2"
    >
      <Badge className={cn("border-0 font-normal", STYLE[state])}>
        <span className="text-muted-foreground/80">{t.label}:</span> {t[state]}
      </Badge>
    </Link>
  );
}
