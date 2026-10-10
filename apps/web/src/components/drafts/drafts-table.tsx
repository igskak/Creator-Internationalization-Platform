import type { DraftRow } from "@rc/modules/content";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

/** Status colors of plan 10 §10.5. */
const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  GENERATING: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  READY_FOR_REVIEW: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  CHANGES_REQUESTED: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  APPROVED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  SCHEDULED: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  PUBLISHING: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  PUBLISHED: "bg-green-200 text-green-950 dark:bg-green-950 dark:text-green-200",
  FAILED: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  REJECTED: "bg-muted text-muted-foreground line-through",
};

/** Flags that stop approval (04 §4.4); the rest are warnings. */
const BLOCKING = new Set([
  "UNSUPPORTED_CLAIM",
  "NUMERIC_MISMATCH",
  "TEXT_OVERFLOW",
  "MISSING_GLYPH",
  "RENDER_FAILED",
  "VISUAL_MISSING",
  "KNOWLEDGE_ARCHIVED",
  "GENERATION_FAILED",
]);

/** The drafts of one tab: idea, market, status, quality, flags, last change and who touched it. */
export function DraftsTable({
  rows,
  t,
  review,
  locale,
}: {
  rows: DraftRow[];
  t: Messages["drafts"];
  review: Messages["review"];
  locale: Locale;
}) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const score = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-64">{t.table.idea}</TableHead>
            <TableHead>{t.table.market}</TableHead>
            <TableHead>{t.table.status}</TableHead>
            <TableHead>{t.table.quality}</TableHead>
            <TableHead>{t.table.flags}</TableHead>
            <TableHead>{t.table.updated}</TableHead>
            <TableHead>{t.table.reviewer}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.variantId} data-market={row.marketCode}>
              <TableCell className="max-w-md whitespace-normal">
                <Link
                  href={`/content/review/${row.ideaId}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.ideaTopic}
                </Link>
              </TableCell>
              <TableCell>
                {row.flagEmoji ? <span aria-hidden="true">{row.flagEmoji} </span> : null}
                {row.marketName}
              </TableCell>
              <TableCell>
                <Badge variant="ghost" className={cn(STATUS_STYLE[row.status])}>
                  {review.status[row.status]}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">
                {row.qualityScore === null ? "—" : score.format(row.qualityScore)}
              </TableCell>
              <TableCell>
                <ul className="flex flex-wrap gap-1">
                  {row.flags.map((flag) => (
                    <li key={flag}>
                      <Badge variant={BLOCKING.has(flag) ? "destructive" : "secondary"}>
                        {(review.flags as Record<string, string>)[flag] ?? flag}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {date.format(row.updatedAt)}
              </TableCell>
              <TableCell>{row.reviewer ?? t.noReviewer}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
