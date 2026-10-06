import { listHistoricalPosts, listPostImports } from "@rc/modules/knowledge";
import { listTaxonomyTerms } from "@rc/modules/settings";
import Link from "next/link";
import { EmptyState } from "@/components/knowledge/cards-states";
import { PostsImport } from "@/components/knowledge/posts-import";
import {
  PostsTable,
  type PostTableRow,
  type TermOptions,
} from "@/components/knowledge/posts-table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /knowledge/posts (plan 10 §10.2, M1-22): imported historical posts with metrics, annotations and
// the example switch, and the result of the latest imports. Filters live in the address.
export const dynamic = "force-dynamic";

const ANNOTATIONS = ["NONE", "AI_SUGGESTED", "HUMAN_CONFIRMED"] as const;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.posts;
  const params = await searchParams;
  const q = (one(params.q) ?? "").trim().slice(0, 200);
  const annotation = ANNOTATIONS.find((a) => a === one(params.annotation));
  const exemplar = one(params.exemplar) === "1";
  const page = Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1);

  const [list, imports, terms] = await Promise.all([
    listHistoricalPosts(ctx, {
      ...(q ? { q } : {}),
      ...(annotation ? { annotation } : {}),
      ...(exemplar ? { exemplar: true } : {}),
      page,
    }),
    listPostImports(ctx),
    listTaxonomyTerms(ctx),
  ]);
  const options = (kind: string) =>
    terms
      .filter((term) => term.kind === kind && term.isActive)
      .map((term) => ({ code: term.code, label: term.label }));
  const termOptions: TermOptions = {
    category: options("category"),
    angle: options("angle"),
    hookType: options("hook_type"),
    ctaType: options("cta_type"),
  };
  const rows: PostTableRow[] = list.rows.map((row) => ({
    id: row.id,
    externalId: row.externalId,
    permalink: row.permalink,
    postedAt: row.postedAt ? row.postedAt.toISOString() : null,
    format: row.format,
    caption: row.caption,
    metrics: row.metrics,
    interactions: row.interactions,
    annotations: row.annotations,
    annotationStatus: row.annotationStatus,
    isExemplar: row.isExemplar,
  }));
  const filtered = Boolean(q || annotation || exemplar);
  const href = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams();
    const merged = {
      q,
      annotation: annotation ?? "",
      exemplar: exemplar ? "1" : "",
      page: "",
      ...patch,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== null && value !== "" && !(key === "page" && Number(value) === 1)) {
        next.set(key, String(value));
      }
    }
    const query = next.toString();
    return query ? `/knowledge/posts?${query}` : "/knowledge/posts";
  };
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>
        <PostsImport />
      </div>

      <section
        aria-labelledby="imports-title"
        className="flex flex-col gap-2 rounded-lg border p-4"
      >
        <div className="flex items-center justify-between">
          <h2 id="imports-title" className="text-base font-medium">
            {t.imports.title}
          </h2>
          <Link
            href="/knowledge/posts"
            className={buttonVariants({ variant: "ghost", size: "xs" })}
          >
            {t.imports.refresh}
          </Link>
        </div>
        {imports.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.imports.none}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {imports.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.fileName}</span>
                  <Badge variant={item.status === "FAILED" ? "destructive" : "outline"}>
                    {(t.imports.status as Record<string, string>)[item.status] ?? item.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {date.format(item.createdAt)}
                  </span>
                </div>
                {item.error ? <p className="text-destructive">{item.error.message}</p> : null}
                {item.report ? (
                  <>
                    <p className="text-muted-foreground">
                      {format(t.imports.summary, {
                        created: item.report.created,
                        updated: item.report.updated,
                        errors: item.report.errorCount,
                        total: item.report.totalRows,
                      })}
                    </p>
                    {item.report.errors.length > 0 ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          {t.imports.showErrors}
                        </summary>
                        <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                          {item.report.errors.map((error) => (
                            <li key={`${error.row}-${error.field ?? ""}`}>
                              <span className="font-medium">
                                {format(t.imports.row, { row: error.row })}
                              </span>
                              {error.field ? ` · ${error.field}` : ""}: {error.message}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

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
            name="annotation"
            defaultValue={annotation ?? ""}
            aria-label={t.filters.annotation}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            <option value="">
              {t.filters.annotation}: {t.filters.all}
            </option>
            {ANNOTATIONS.map((value) => (
              <option key={value} value={value}>
                {t.status[value]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="exemplar"
              value="1"
              defaultChecked={exemplar}
              className="size-4 accent-primary"
            />
            {t.filters.exemplars}
          </label>
          <button type="submit" className={buttonVariants({ size: "sm" })}>
            {t.filters.apply}
          </button>
          {filtered ? (
            <Link
              href="/knowledge/posts"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t.filters.clear}
            </Link>
          ) : null}
        </form>
      </search>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState title={t.empty.filteredTitle} body={t.empty.filteredBody} />
        ) : (
          <EmptyState title={t.empty.title} body={t.empty.body} />
        )
      ) : (
        <>
          <PostsTable rows={rows} terms={termOptions} />
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
                  href={href({ page: list.page - 1 })}
                >
                  {t.pagination.previous}
                </Link>
              ) : null}
              {list.page < lastPage ? (
                <Link
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  href={href({ page: list.page + 1 })}
                >
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
