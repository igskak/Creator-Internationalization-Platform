import { Badge } from "@/components/ui/badge";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

const STYLE: Record<string, string> = {
  READY: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  FAILED: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  BLOCKED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  PROCESSING: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  QUEUED: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
};

/** Status badge and, while the source is processed, a progress bar. */
export function SourceStatus({
  status,
  percent,
  t,
}: {
  status: string;
  percent: number | null;
  t: Messages["sources"];
}) {
  const label = (t.status as Record<string, string>)[status] ?? status;
  const running = status === "PROCESSING" || status === "QUEUED";
  return (
    <div className="flex min-w-32 flex-col gap-1">
      <Badge
        variant="ghost"
        className={cn("w-fit", STYLE[status] ?? "bg-muted text-muted-foreground")}
      >
        {label}
      </Badge>
      {running && percent !== null ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={label}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}
