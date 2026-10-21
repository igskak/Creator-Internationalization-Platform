import { listPublished } from "@rc/modules/analytics";
import { listMarkets } from "@rc/modules/localization";
import { DownloadIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { compact, percent } from "@/components/analytics/chart-math";
import { MeasuredCell, WatchCell } from "@/components/analytics/published-cells";
import { EmptyState } from "@/components/knowledge/cards-states";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { PUBLISHED_FORMATS, parsePublishedSearch, publishedHref } from "@/lib/published-query";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /content/published (plan 10 §10.2, M6-09): the posts that went out, newest first, with their
// numbers at day 7 (before that, the newest snapshot, marked early), a Reel's watch metrics, a link
// to each post's lineage, and the list as a CSV file.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const pill = (active: boolean) =>
  cn(
    "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted",
    active && "border-foreground/30 bg-muted font-medium",
  );

export default async function PublishedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.published;
  const filters = parsePublishedSearch(await searchParams);
  const [list, markets] = await Promise.all([
    listPublished(ctx, {
      ...(filters.market ? { market: filters.market } : {}),
      ...(filters.format ? { format: filters.format } : {}),
      page: filters.page,
      pageSize: PAGE_SIZE,
    }),
    listMarkets(ctx),
  ]);
  const filtered = Boolean(filters.market || filters.format);
  const from = (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.total, list.page * list.pageSize);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const rate = (v: number | null) => (v === null ? "—" : percent(v, locale));
  const link = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <main className="flex max-w-7xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>
        {list.total > 0 ? (
          <a
            href={publishedHref(filters, {}, "/content/published/export")}
            className={link}
            title={t.exportHint}
          >
            <DownloadIcon aria-hidden="true" className="size-4" /> {t.exportCsv}
          </a>
        ) : null}
      </div>

      <nav aria-label={t.title} className="flex flex-wrap items-center gap-1.5">
        <Link
          href={publishedHref(filters, { market: undefined })}
          aria-current={!filters.market ? "true" : undefined}
          className={pill(!filters.market)}
        >
          {t.filters.allMarkets}
        </Link>
        {markets
          .filter((m) => m.isActive)
          .map((m) => (
            <Link
              key={m.code}
              href={publishedHref(filters, { market: m.code })}
              aria-current={filters.market === m.code ? "true" : undefined}
              className={pill(filters.market === m.code)}
            >
              {m.flagEmoji ? <span aria-hidden="true">{m.flagEmoji} </span> : null}
              {m.displayName}
            </Link>
          ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Link
          href={publishedHref(filters, { format: undefined })}
          aria-current={!filters.format ? "true" : undefined}
          className={pill(!filters.format)}
        >
          {t.filters.allFormats}
        </Link>
        {PUBLISHED_FORMATS.map((f) => (
          <Link
            key={f}
            href={publishedHref(filters, { format: f })}
            aria-current={filters.format === f ? "true" : undefined}
            className={pill(filters.format === f)}
          >
            {messages.lineage.format[f]}
          </Link>
        ))}
      </nav>

      {list.rows.length === 0 ? (
        <EmptyState title={filtered ? t.emptyFiltered : t.empty} body="" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-64">{t.table.post}</TableHead>
                  <TableHead>{t.table.market}</TableHead>
                  <TableHead>{t.table.published}</TableHead>
                  <TableHead className="text-right">{t.table.reach}</TableHead>
                  <TableHead className="text-right">{t.table.saves}</TableHead>
                  <TableHead className="text-right">{t.table.shares}</TableHead>
                  <TableHead className="text-right">{t.table.comments}</TableHead>
                  <TableHead>{t.table.watch}</TableHead>
                  <TableHead>{t.table.measured}</TableHead>
                  <TableHead>{t.table.link}</TableHead>
                  <TableHead>{t.table.youtube}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((r) => (
                  <TableRow key={r.publicationId} data-post={r.publicationId}>
                    <TableCell className="max-w-sm whitespace-normal">
                      <Link
                        href={`/content/published/${r.publicationId}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {r.hook ?? r.publicationId.slice(0, 8)}
                      </Link>
                      <Badge variant="secondary" className="ml-2">
                        {(messages.lineage.format as Record<string, string>)[r.format] ?? r.format}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.marketCode}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {date.format(r.publishedAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.reach === null ? "—" : compact(r.reach, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{rate(r.saveRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rate(r.shareRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rate(r.commentRate)}</TableCell>
                    <TableCell>
                      {r.format === "REEL" ? (
                        <WatchCell row={r} t={t} locale={locale} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <MeasuredCell row={r} t={t} />
                    </TableCell>
                    <TableCell>
                      {r.permalink ? (
                        <a
                          href={r.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                        >
                          {t.openOnInstagram}
                          <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {r.youtubeUrl ? (
                        <a
                          href={r.youtubeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                        >
                          {t.openOnYouTube}
                          <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <nav
            aria-label={t.pagination.label}
            className="flex items-center justify-between text-sm text-muted-foreground"
          >
            <span>{format(t.pagination.range, { from, to, total: list.total })}</span>
            <span className="flex gap-2">
              {list.page > 1 ? (
                <Link className={link} href={publishedHref(filters, { page: list.page - 1 })}>
                  {t.pagination.previous}
                </Link>
              ) : null}
              {to < list.total ? (
                <Link className={link} href={publishedHref(filters, { page: list.page + 1 })}>
                  {t.pagination.next}
                </Link>
              ) : null}
            </span>
          </nav>
        </>
      )}
    </main>
  );
}
