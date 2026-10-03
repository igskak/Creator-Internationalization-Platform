import { APPROVE_BATCH, type CardStatus, listKnowledgeCards } from "@rc/modules/knowledge";
import { listTaxonomyTerms } from "@rc/modules/settings";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CardsPagination, EmptyState } from "@/components/knowledge/cards-states";
import { CardsTable } from "@/components/knowledge/cards-table";
import { CardsToolbar } from "@/components/knowledge/cards-toolbar";
import {
  cardsHref,
  clearedFilters,
  hasActiveFilters,
  parseCardsSearch,
  toListInput,
} from "@/lib/cards-query";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /knowledge/cards (plan 10 §10.2, M1-17): the cards of the knowledge base with review status,
// filters, search and bulk approve/archive. The filters live in the address.
export const dynamic = "force-dynamic";

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.cards;
  const filters = parseCardsSearch(await searchParams);

  const [list, terms] = await Promise.all([
    listKnowledgeCards(ctx, toListInput(filters)),
    listTaxonomyTerms(ctx),
  ]);

  // A page past the end (a filter narrowed the list since the link was made): go to the last one.
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
  if (list.rows.length === 0 && list.total > 0 && filters.page > lastPage) {
    redirect(cardsHref(filters, { page: lastPage }));
  }

  const categoryNames = new Map(
    terms.filter((term) => term.kind === "category").map((term) => [term.code, term.label]),
  );
  const categoryLabel = (code: string) => categoryNames.get(code) ?? code;
  const languageNames = new Intl.DisplayNames(locale, { type: "language" });

  const counts: Record<CardStatus | "all", number> = {
    ...list.statusCounts,
    all: Object.values(list.statusCounts).reduce((sum, n) => sum + n, 0),
  };
  // Cards still being checked (EXTRACTED) show up as their own tab only while there are any.
  const tabs: (CardStatus | "all")[] = [
    "NEEDS_REVIEW",
    "CHEF_APPROVED",
    "ARCHIVED",
    ...(counts.EXTRACTED > 0 ? (["EXTRACTED"] as const) : []),
    "all",
  ];
  const filtered = hasActiveFilters(filters);
  const nothingYet = counts.all === 0 && !filtered;
  const reviewDone = counts.all > 0 && filters.status === "NEEDS_REVIEW" && !filtered;

  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground">{t.subtitle}</p>
      </div>

      {nothingYet ? (
        <EmptyState
          title={t.empty.noneTitle}
          body={t.empty.noneBody}
          action={{ href: "/knowledge/sources", label: t.empty.noneAction }}
        />
      ) : (
        <>
          <nav aria-label={t.title} className="flex flex-wrap gap-1.5">
            {tabs.map((tab) => (
              <Link
                key={tab}
                href={cardsHref(filters, { status: tab })}
                aria-current={filters.status === tab ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted",
                  filters.status === tab && "border-foreground/30 bg-muted font-medium",
                )}
              >
                {t.tabs[tab]}{" "}
                <span className="text-muted-foreground tabular-nums">{counts[tab]}</span>
              </Link>
            ))}
          </nav>

          <CardsToolbar
            filters={filters}
            facets={{
              categories: list.facets.categories.map((f) => ({
                ...f,
                label: categoryLabel(f.value),
              })),
              flags: list.facets.flags.map((f) => ({ ...f, label: f.value })),
              sources: list.facets.sources.map((f) => ({ ...f, label: f.label ?? f.value })),
              languages: list.facets.languages.map((f) => ({
                ...f,
                label: languageNames.of(f.value) ?? f.value,
              })),
            }}
          />

          {list.rows.length === 0 ? (
            reviewDone ? (
              <EmptyState title={t.empty.reviewDoneTitle} body={t.empty.reviewDoneBody} />
            ) : (
              <EmptyState
                title={t.empty.filteredTitle}
                body={t.empty.filteredBody}
                {...(filtered
                  ? { action: { href: cardsHref(clearedFilters(filters)), label: t.empty.clear } }
                  : {})}
              />
            )
          ) : (
            <>
              <CardsTable
                rows={list.rows.map((row) => ({
                  id: row.id,
                  title: row.title,
                  claim: row.claim,
                  language: row.language,
                  categoryLabel: categoryLabel(row.category),
                  flags: row.flags,
                  confidence: row.confidence,
                  quoteVerified: row.quoteVerified,
                  sourceTitle: row.sourceTitle,
                  pageStart: row.pageStart,
                }))}
                canApprove={user.role === "chef" || user.role === "owner"}
                approvable={list.approvable}
                approveBatch={APPROVE_BATCH}
              />
              <CardsPagination
                t={t}
                filters={filters}
                total={list.total}
                page={list.page}
                pageSize={list.pageSize}
              />
            </>
          )}
        </>
      )}
    </main>
  );
}
