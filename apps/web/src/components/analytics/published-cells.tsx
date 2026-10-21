import type { PublishedRow } from "@rc/modules/analytics";
import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { percent } from "./chart-math";

// Two cells of a row on the Published list (M6-09): which snapshot the numbers are from (day 7, an
// earlier one from D3 on, or an early one before that), and a Reel's watch metrics at it.

type T = Messages["published"];

export function MeasuredCell({ row, t }: { row: PublishedRow; t: T }) {
  if (row.slot === null) return <span className="text-muted-foreground">{t.noNumbers}</span>;
  if (row.isExactD7) return <>{t.measuredAt}</>;
  if (row.early)
    return (
      <Badge variant="outline" title={t.earlyHint} data-early="true">
        {format(t.early, { slot: row.slot })}
      </Badge>
    );
  return <Badge variant="outline">{format(t.fallback, { slot: row.slot })}</Badge>;
}

export function WatchCell({ row, t, locale }: { row: PublishedRow; t: T; locale: Locale }) {
  const w = row.watch;
  const lines = w
    ? [
        w.avgWatchSeconds === null
          ? null
          : format(t.watch.avg, { n: Math.round(w.avgWatchSeconds * 10) / 10 }),
        w.hookRate === null ? null : format(t.watch.stayed, { p: percent(w.hookRate, locale) }),
        w.completion === null
          ? null
          : format(t.watch.watched, { p: percent(w.completion, locale) }),
      ].filter((l): l is string => l !== null)
    : [];
  if (lines.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="flex flex-col text-xs whitespace-nowrap" data-testid="watch">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}
