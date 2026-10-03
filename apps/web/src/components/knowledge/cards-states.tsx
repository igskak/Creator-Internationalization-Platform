import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { type CardsFilters, cardsHref } from "@/lib/cards-query";
import { format } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";

type T = Messages["cards"];

/** An empty state with a title, one sentence and an optional next step (plan 10 §10.5). */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <section className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-8">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action ? (
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}

/** Previous/next links and the range shown, for the list below. */
export function CardsPagination({
  t,
  filters,
  total,
  page,
  pageSize,
}: {
  t: T;
  filters: CardsFilters;
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
      aria-label={t.pagination.label}
      className="flex items-center justify-between text-sm text-muted-foreground"
    >
      <span>{format(t.pagination.range, { from, to, total })}</span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className={link} href={cardsHref(filters, { page: page - 1 })}>
            {t.pagination.previous}
          </Link>
        ) : null}
        {page < last ? (
          <Link className={link} href={cardsHref(filters, { page: page + 1 })}>
            {t.pagination.next}
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
