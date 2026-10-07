import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { format } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import { type IdeasFilters, ideasHref } from "@/lib/ideas-query";

/** Previous/next links and the range shown, under the ideas list. */
export function IdeasPagination({
  t,
  filters,
  total,
  page,
  pageSize,
}: {
  t: Messages["ideas"]["pagination"];
  filters: IdeasFilters;
  total: number;
  page: number;
  pageSize: number;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const link = buttonVariants({ variant: "outline", size: "sm" });
  return (
    <nav
      aria-label={t.label}
      className="flex items-center justify-between text-sm text-muted-foreground"
    >
      <span>{format(t.range, { from, to, total })}</span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className={link} href={ideasHref(filters, { page: page - 1 })}>
            {t.previous}
          </Link>
        ) : null}
        {page < last ? (
          <Link className={link} href={ideasHref(filters, { page: page + 1 })}>
            {t.next}
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
