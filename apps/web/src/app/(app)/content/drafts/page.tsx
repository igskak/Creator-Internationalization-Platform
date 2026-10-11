import { listDrafts } from "@rc/modules/content";
import { listMarkets } from "@rc/modules/localization";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DraftsTable } from "@/components/drafts/drafts-table";
import { EmptyState } from "@/components/knowledge/cards-states";
import { buttonVariants } from "@/components/ui/button";
import { DRAFT_TABS, draftsHref, parseDraftsSearch } from "@/lib/drafts-query";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /content/drafts (plan 10 §10.2, M4-07): the draft queue of every market, by status group, with
// a market filter and a "flags only" filter. A row opens the review screen of its idea.
export const dynamic = "force-dynamic";

const pill = (active: boolean) =>
  cn(
    "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted",
    active && "border-foreground/30 bg-muted font-medium",
  );

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.drafts;
  const filters = parseDraftsSearch(await searchParams);

  const [list, markets] = await Promise.all([
    listDrafts(ctx, {
      tab: filters.tab,
      ...(filters.market ? { market: filters.market } : {}),
      flagged: filters.flagged,
      page: filters.page,
    }),
    listMarkets(ctx),
  ]);

  // A page past the end (drafts moved since the link was made): go to the last one.
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
  if (list.rows.length === 0 && list.total > 0 && filters.page > lastPage) {
    redirect(draftsHref(filters, { page: lastPage }));
  }

  const everything = Object.values(list.tabCounts).reduce((sum, n) => sum + n, 0);
  const filtered = Boolean(filters.market) || filters.flagged;
  const from = (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.total, list.page * list.pageSize);
  const link = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <main className="flex max-w-7xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground">{t.subtitle}</p>
      </div>

      {everything === 0 && !filtered ? (
        <EmptyState
          title={t.empty.noneTitle}
          body={t.empty.noneBody}
          action={{ href: "/content/ideas", label: t.empty.noneAction }}
        />
      ) : (
        <>
          <nav aria-label={t.title} className="flex flex-wrap gap-1.5">
            {DRAFT_TABS.map((tab) => (
              <Link
                key={tab}
                href={draftsHref(filters, { tab })}
                aria-current={filters.tab === tab ? "page" : undefined}
                className={pill(filters.tab === tab)}
              >
                {t.tabs[tab]}{" "}
                <span className="text-muted-foreground tabular-nums">{list.tabCounts[tab]}</span>
              </Link>
            ))}
          </nav>

          <nav aria-label={t.filters.label} className="flex flex-wrap items-center gap-1.5 text-sm">
            <Link
              href={draftsHref(filters, { market: undefined })}
              aria-current={filters.market ? undefined : "true"}
              className={pill(!filters.market)}
            >
              {t.filters.allMarkets}
            </Link>
            {markets
              .filter((m) => m.isActive)
              .map((m) => (
                <Link
                  key={m.code}
                  href={draftsHref(filters, { market: m.code })}
                  aria-current={filters.market === m.code ? "true" : undefined}
                  className={pill(filters.market === m.code)}
                >
                  {m.flagEmoji ? <span aria-hidden="true">{m.flagEmoji} </span> : null}
                  {m.displayName}
                </Link>
              ))}
            <Link
              href={draftsHref(filters, { flagged: !filters.flagged })}
              aria-pressed={filters.flagged}
              className={pill(filters.flagged)}
            >
              {t.filters.flagged}
            </Link>
            {filtered ? (
              <Link
                href={draftsHref(filters, { market: undefined, flagged: false })}
                className="text-muted-foreground underline-offset-4 hover:underline"
              >
                {t.filters.clear}
              </Link>
            ) : null}
          </nav>

          {list.rows.length === 0 ? (
            <EmptyState title={t.empty.tabTitle} body={t.empty.tabBody} />
          ) : (
            <>
              <DraftsTable rows={list.rows} t={t} review={messages.review} locale={locale} />
              <nav
                aria-label={t.pagination.label}
                className="flex items-center justify-between text-sm text-muted-foreground"
              >
                <span>{format(t.pagination.range, { from, to, total: list.total })}</span>
                <span className="flex gap-2">
                  {list.page > 1 ? (
                    <Link className={link} href={draftsHref(filters, { page: list.page - 1 })}>
                      {t.pagination.previous}
                    </Link>
                  ) : null}
                  {list.page < lastPage ? (
                    <Link className={link} href={draftsHref(filters, { page: list.page + 1 })}>
                      {t.pagination.next}
                    </Link>
                  ) : null}
                </span>
              </nav>
            </>
          )}
        </>
      )}
    </main>
  );
}
