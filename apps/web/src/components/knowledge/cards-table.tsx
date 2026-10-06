"use client";

import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/hooks/use-action";
import { format, formatNumber, plural } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { bulkTransitionKnowledgeCards } from "@/server/actions/knowledge";
import { FlagBadges } from "./flag-badges";

/** One list row as the browser needs it. */
export type CardRowView = {
  id: string;
  title: string;
  claim: string;
  language: string;
  categoryLabel: string;
  flags: string[];
  confidence: number | null;
  quoteVerified: boolean | null;
  sourceTitle: string | null;
  pageStart: number | null;
};

const ARCHIVE_REASONS = ["OUT_OF_SCOPE", "INACCURATE", "DUPLICATE", "OTHER"] as const;
type BulkResult = { done: string[]; skipped: { id: string; reason: string }[] };

/**
 * The cards of the current page with selection, and the bulk actions: approve, archive with a
 * reason, and "approve verified" (cards with a verified quote and no flags).
 */
export function CardsTable({
  rows,
  canApprove,
  approvable,
  approveBatch,
}: {
  rows: CardRowView[];
  canApprove: boolean;
  /** Cards of the whole list (not just this page) that "approve verified" would approve now. */
  approvable: { count: number; ids: string[] };
  approveBatch: number;
}) {
  const { locale, messages } = useI18n();
  const t = messages.cards;
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reason, setReason] = useState<(typeof ARCHIVE_REASONS)[number]>("OUT_OF_SCOPE");

  // Keep the selection to cards that are still on the page after a refresh.
  useEffect(() => {
    setSelected((current) => {
      const ids = new Set(rows.map((r) => r.id));
      const kept = new Set([...current].filter((id) => ids.has(id)));
      return kept.size === current.size ? current : kept;
    });
  }, [rows]);

  const summarize = (result: BulkResult, done: PluralFormsKey) => {
    if (result.done.length > 0) toast.success(plural(locale, t.result[done], result.done.length));
    if (result.skipped.length > 0) {
      const counts = new Map<string, number>();
      for (const s of result.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
      const why = [...counts]
        .map(([r, n]) => `${t.result.reasons[r as keyof typeof t.result.reasons] ?? r} (${n})`)
        .join(", ");
      toast.warning(plural(locale, t.result.skipped, result.skipped.length), { description: why });
    }
    setSelected(new Set());
    router.refresh();
  };

  const approve = useAction(bulkTransitionKnowledgeCards, {
    onSuccess: (result) => summarize(result, "approved"),
  });
  const archive = useAction(bulkTransitionKnowledgeCards, {
    onSuccess: (result) => {
      setArchiveOpen(false);
      summarize(result, "archived");
    },
  });
  const busy = approve.pending || archive.pending;
  const ids = [...selected];
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        {selected.size > 0 ? (
          <div
            role="status"
            className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm"
          >
            <span className="font-medium">{plural(locale, t.bulk.selected, selected.size)}</span>
            <span className="flex-1" />
            <Button
              size="sm"
              disabled={busy || !canApprove}
              title={canApprove ? undefined : t.bulk.onlyChef}
              onClick={() => approve.run({ ids, to: "CHEF_APPROVED" })}
            >
              {t.bulk.approve}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setArchiveOpen(true)}
            >
              {t.bulk.archive}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t.bulk.clear}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t.order}</p>
            <span className="flex-1" />
            {approvable.count > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !canApprove}
                title={
                  canApprove
                    ? format(t.bulk.approveVerifiedHint, { batch: approveBatch })
                    : t.bulk.onlyChef
                }
                onClick={() => approve.run({ ids: approvable.ids, to: "CHEF_APPROVED" })}
              >
                {format(t.bulk.approveVerified, { count: approvable.count })}
              </Button>
            ) : null}
          </>
        )}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  aria-label={t.selectAll}
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                  }
                />
              </TableHead>
              <TableHead>{t.columns.card}</TableHead>
              <TableHead className="hidden md:table-cell">{t.filters.category}</TableHead>
              <TableHead className="hidden sm:table-cell">{t.filters.flags}</TableHead>
              <TableHead className="w-24 text-right">{t.columns.check}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-state={selected.has(row.id) ? "selected" : undefined}>
                <TableCell>
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    aria-label={format(t.selectRow, { title: row.title })}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                </TableCell>
                <TableCell className="max-w-0 min-w-56 whitespace-normal">
                  <Link
                    href={`/knowledge/cards/${row.id}`}
                    lang={row.language}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.title}
                  </Link>
                  <p lang={row.language} className="truncate text-xs text-muted-foreground">
                    {row.claim}
                  </p>
                  {row.sourceTitle ? (
                    <p className="truncate text-xs text-muted-foreground/80">
                      {row.pageStart
                        ? format(t.sourcePage, { source: row.sourceTitle, page: row.pageStart })
                        : row.sourceTitle}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant="outline">{row.categoryLabel}</Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <div className="flex flex-wrap gap-1">
                    <FlagBadges flags={row.flags} />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <QuoteCheck row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{plural(locale, t.archiveDialog.title, selected.size)}</DialogTitle>
            <DialogDescription>{t.archiveDialog.description}</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{t.archiveDialog.reason}</span>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={reason}
              onChange={(event) => setReason(event.target.value as typeof reason)}
            >
              {ARCHIVE_REASONS.map((value) => (
                <option key={value} value={value}>
                  {t.archiveDialog.reasons[value]}
                </option>
              ))}
            </select>
          </label>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setArchiveOpen(false)}
              disabled={archive.pending}
            >
              {t.archiveDialog.cancel}
            </Button>
            <Button
              disabled={archive.pending}
              onClick={() => archive.run({ ids, to: "ARCHIVED", archiveReason: reason })}
            >
              {t.archiveDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type PluralFormsKey = "approved" | "archived";

/** Quote check mark or warning, with the model's confidence. */
function QuoteCheck({ row }: { row: CardRowView }) {
  const { locale, messages } = useI18n();
  const t = messages.cards;
  const confidence = row.confidence === null ? "—" : formatNumber(locale, row.confidence, 2);
  const hint =
    row.quoteVerified === true
      ? t.quote.verified
      : row.quoteVerified === false
        ? t.quote.unverified
        : t.quote.manual;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-end gap-1 text-xs tabular-nums",
        row.quoteVerified === true && "text-emerald-700 dark:text-emerald-400",
        row.quoteVerified === false && "text-amber-700 dark:text-amber-400",
        row.quoteVerified === null && "text-muted-foreground",
      )}
      title={`${hint}. ${format(t.confidence, { value: confidence })}`}
    >
      {row.quoteVerified === true ? <CheckIcon aria-hidden="true" className="size-3.5" /> : null}
      {row.quoteVerified === false ? (
        <AlertTriangleIcon aria-hidden="true" className="size-3.5" />
      ) : null}
      <span className="sr-only">{hint}. </span>
      {confidence}
    </span>
  );
}
