import Link from "next/link";
import { IdeaStatusBadge } from "@/components/ideas/idea-status";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { plural } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";

export type IdeaRowView = {
  id: string;
  topic: string;
  coreMessage: string;
  categoryLabel: string;
  angleLabel: string;
  intent: "NONE" | "LEAD_MAGNET" | "PRODUCT_SALE" | "NURTURE";
  productName: string | null;
  origin: "AI_GENERATED" | "MANUAL";
  status: string;
  cardCount: number;
  createdAt: Date;
};

/** The ideas of one tab: topic and core message, what it is about, the offer and how many cards back it. */
export function IdeasTable({
  rows,
  t,
  locale,
}: {
  rows: IdeaRowView[];
  t: Messages["ideas"];
  locale: Locale;
}) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-72">{t.table.idea}</TableHead>
            <TableHead>{t.table.categoryAngle}</TableHead>
            <TableHead>{t.table.offer}</TableHead>
            <TableHead>{t.table.created}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-xl whitespace-normal">
                <Link
                  href={`/content/ideas/${row.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.topic}
                </Link>
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                  {row.coreMessage}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <IdeaStatusBadge
                    status={row.status}
                    label={t.tabs[row.status as keyof typeof t.tabs]}
                  />
                  <Badge variant="outline">{t.origin[row.origin]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {plural(locale, t.cardsCount, row.cardCount)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="whitespace-normal">
                <div>{row.categoryLabel}</div>
                <div className="text-sm text-muted-foreground">{row.angleLabel}</div>
              </TableCell>
              <TableCell className="whitespace-normal">
                {row.intent === "NONE" ? (
                  <span className="text-muted-foreground">{t.intent.NONE}</span>
                ) : (
                  <>
                    <div>{row.productName}</div>
                    <div className="text-sm text-muted-foreground">{t.intent[row.intent]}</div>
                  </>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {date.format(row.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
