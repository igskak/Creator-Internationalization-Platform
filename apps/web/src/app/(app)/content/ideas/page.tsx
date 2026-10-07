import { IDEA_STATUSES, listActiveProducts, listIdeas } from "@rc/modules/content";
import { listTaxonomyTerms } from "@rc/modules/settings";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GenerateIdeasDialog } from "@/components/ideas/generate-dialog";
import { IdeasPagination } from "@/components/ideas/ideas-pagination";
import { IdeasTable } from "@/components/ideas/ideas-table";
import { EmptyState } from "@/components/knowledge/cards-states";
import { buttonVariants } from "@/components/ui/button";
import { getI18n } from "@/lib/i18n/server";
import { ideasHref, parseIdeasSearch } from "@/lib/ideas-query";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /content/ideas (plan 10 §10.2, M2-08): Master Ideas by status, with "Generate ideas" and a form
// for a manual idea. The tab and page live in the address.
export const dynamic = "force-dynamic";

export default async function IdeasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.ideas;
  const filters = parseIdeasSearch(await searchParams);

  const [list, terms, products] = await Promise.all([
    listIdeas(ctx, { status: filters.status, page: filters.page }),
    listTaxonomyTerms(ctx),
    listActiveProducts(ctx),
  ]);

  // A page past the end (ideas moved since the link was made): go to the last one.
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
  if (list.rows.length === 0 && list.total > 0 && filters.page > lastPage) {
    redirect(ideasHref(filters, { page: lastPage }));
  }

  const active = terms.filter((term) => term.isActive);
  const categories = active.filter((term) => term.kind === "category");
  const angles = active.filter((term) => term.kind === "angle");
  const label = (kind: string, code: string) =>
    terms.find((term) => term.kind === kind && term.code === code)?.label ?? code;
  const total = Object.values(list.statusCounts).reduce((sum, n) => sum + n, 0);

  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GenerateIdeasDialog
            categories={categories.map(({ code, label }) => ({ code, label }))}
            angles={angles.map(({ code, label }) => ({ code, label }))}
            products={products.map(({ id, name }) => ({ id, name }))}
          />
          <Link
            href="/content/ideas/new"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <PlusIcon /> {t.newIdea}
          </Link>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState
          title={t.empty.noneTitle}
          body={t.empty.noneBody}
          action={{ href: "/knowledge/cards", label: t.empty.noneAction }}
        />
      ) : (
        <>
          <nav aria-label={t.title} className="flex flex-wrap gap-1.5">
            {IDEA_STATUSES.map((tab) => (
              <Link
                key={tab}
                href={ideasHref(filters, { status: tab })}
                aria-current={filters.status === tab ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted",
                  filters.status === tab && "border-foreground/30 bg-muted font-medium",
                )}
              >
                {t.tabs[tab]}{" "}
                <span className="text-muted-foreground tabular-nums">{list.statusCounts[tab]}</span>
              </Link>
            ))}
          </nav>
          {list.rows.length === 0 ? (
            <EmptyState title={t.empty.tabTitle} body={t.empty.tabBody} />
          ) : (
            <>
              <IdeasTable
                t={t}
                locale={locale}
                rows={list.rows.map((row) => ({
                  id: row.id,
                  topic: row.topic,
                  coreMessage: row.coreMessage,
                  categoryLabel: label("category", row.category),
                  angleLabel: label("angle", row.angle),
                  intent: row.commercialIntent,
                  productName: row.productName,
                  origin: row.origin,
                  status: row.status,
                  cardCount: row.cardCount,
                  createdAt: row.createdAt,
                }))}
              />
              <IdeasPagination
                t={t.pagination}
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
