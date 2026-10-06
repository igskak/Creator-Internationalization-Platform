import {
  ACCEPTED_FORMATS,
  getAllRightsDefaults,
  listSources,
  MAX_TEXT_CHARS,
} from "@rc/modules/knowledge";
import Link from "next/link";
import { EmptyState } from "@/components/knowledge/cards-states";
import { SourceStatus } from "@/components/knowledge/source-status";
import { SourceUpload, type SourceUploadConfig } from "@/components/knowledge/source-upload";
import { SourcesPoller } from "@/components/knowledge/sources-poller";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /knowledge/sources (plan 10 §10.2, M1-04): the source library with status, progress, rights and
// card count, and the upload dialog. The filters live in the address.
export const dynamic = "force-dynamic";

const STATUSES = ["QUEUED", "PROCESSING", "READY", "FAILED", "BLOCKED", "PENDING_UPLOAD"] as const;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.sources;
  const params = await searchParams;
  const q = (one(params.q) ?? "").trim().slice(0, 200);
  const status = STATUSES.find((s) => s === one(params.status));
  const archived = one(params.archived) === "1";
  const page = Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1);

  const [list, defaults] = await Promise.all([
    listSources(ctx, {
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
      includeArchived: archived,
      page,
    }),
    getAllRightsDefaults(ctx),
  ]);
  const config: SourceUploadConfig = {
    defaults,
    formats: Object.fromEntries(
      Object.entries(ACCEPTED_FORMATS).map(([type, formats]) => [
        type,
        {
          extensions: Object.keys(formats ?? {}),
          maxMb: Math.max(...Object.values(formats ?? {}).map((f) => f.maxBytes / (1024 * 1024))),
        },
      ]),
    ),
    maxTextChars: MAX_TEXT_CHARS,
  };
  const filtered = Boolean(q || status || archived);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const bytes = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
  const href = (next: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    if (archived) query.set("archived", "1");
    if (next > 1) query.set("page", String(next));
    const text = query.toString();
    return text ? `/knowledge/sources?${text}` : "/knowledge/sources";
  };

  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6">
      <SourcesPoller
        sources={list.rows.map((r) => ({ id: r.id, status: r.status, percent: r.percent }))}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>
        <SourceUpload config={config} />
      </div>

      <search>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t.filters.search}
            aria-label={t.filters.search}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm sm:w-64"
          />
          <select
            name="status"
            defaultValue={status ?? ""}
            aria-label={t.filters.status}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">
              {t.filters.status}: {t.filters.all}
            </option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t.status[value]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="archived"
              value="1"
              defaultChecked={archived}
              className="size-4 accent-primary"
            />
            {t.filters.archived}
          </label>
          <button type="submit" className={buttonVariants({ size: "sm" })}>
            {t.filters.apply}
          </button>
          {filtered ? (
            <Link
              href="/knowledge/sources"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t.filters.clear}
            </Link>
          ) : null}
        </form>
      </search>

      {list.rows.length === 0 ? (
        filtered ? (
          <EmptyState title={t.empty.filteredTitle} body={t.empty.filteredBody} />
        ) : (
          <EmptyState title={t.empty.title} body={t.empty.body} />
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t.table.source}</th>
                <th className="px-3 py-2 font-medium">{t.table.status}</th>
                <th className="px-3 py-2 font-medium">{t.table.rights}</th>
                <th className="px-3 py-2 font-medium">{t.table.cards}</th>
                <th className="px-3 py-2 font-medium">{t.table.added}</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="max-w-md px-3 py-3">
                    <Link
                      href={`/knowledge/sources/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.title}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{t.types[row.type]}</span>
                      <span>{row.language}</span>
                      {row.pageCount ? (
                        <span>{format(t.table.pages, { count: row.pageCount })}</span>
                      ) : null}
                      {row.sizeBytes ? (
                        <span>{bytes.format(row.sizeBytes / (1024 * 1024))} MB</span>
                      ) : null}
                      {row.archived ? <Badge variant="outline">{t.table.archived}</Badge> : null}
                    </p>
                    {row.error ? (
                      <p className="mt-1 text-xs text-destructive">{row.error.message}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <SourceStatus status={row.status} percent={row.percent} t={t} />
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant="outline">{t.permission[row.aiProcessing]}</Badge>
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.cards > 0 ? (
                      <Link
                        href={`/knowledge/cards?source=${row.id}&status=all`}
                        className="underline underline-offset-4"
                      >
                        {row.cards}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {date.format(row.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.total > list.pageSize ? (
        <nav
          className="flex items-center justify-between text-sm text-muted-foreground"
          aria-label={t.title}
        >
          <span>
            {format(t.pagination.range, {
              from: (list.page - 1) * list.pageSize + 1,
              to: Math.min(list.page * list.pageSize, list.total),
              total: list.total,
            })}
          </span>
          <span className="flex gap-2">
            {list.page > 1 ? (
              <Link
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={href(list.page - 1)}
              >
                {t.pagination.previous}
              </Link>
            ) : null}
            {list.page < lastPage ? (
              <Link
                className={buttonVariants({ variant: "outline", size: "sm" })}
                href={href(list.page + 1)}
              >
                {t.pagination.next}
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}
    </main>
  );
}
