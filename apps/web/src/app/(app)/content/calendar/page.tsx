import { listMarkets } from "@rc/modules/localization";
import { getCalendar, listApprovedNotScheduled } from "@rc/modules/publishing";
import { localDate, offsetLabel } from "@rc/modules/publishing/time";
import { AlertTriangleIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { PostButton, ScheduleButton } from "@/components/calendar/calendar-dialogs";
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
import {
  addDays,
  type CalendarFilters,
  calendarHref,
  clock,
  parseCalendarSearch,
  todayIn,
  weekRange,
} from "@/lib/calendar-query";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /content/calendar (plan 10 §10.2, M4-09): the week's posts by day, a list of the same, and the
// approved drafts that still need a time. Times are drawn in one zone (a market's, chosen in the
// address); each post also knows its own market's zone for scheduling and moving.
export const dynamic = "force-dynamic";

/** One color per market, by its position (stable across weeks). */
const MARKET_COLORS = [
  "border-l-sky-500",
  "border-l-rose-500",
  "border-l-emerald-500",
  "border-l-amber-500",
];
const STATUS_STYLE: Record<string, string> = {
  SCHEDULED: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  QUEUED: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  IN_PROGRESS: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  PUBLISHED: "bg-green-200 text-green-950 dark:bg-green-950 dark:text-green-200",
  FAILED: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.calendar;
  const filters = parseCalendarSearch(await searchParams);
  const canSchedule = user.role === "owner" || user.role === "editor";

  const markets = (await listMarkets(ctx)).filter((m) => m.isActive);
  const zoneMarket = markets.find((m) => m.code === filters.zone) ?? markets[0];
  const zone = zoneMarket?.timezone ?? "UTC";
  const now = ctx.clock.now();
  const range = weekRange(filters, now, zone);
  const [items, waiting] = await Promise.all([
    getCalendar(ctx, { from: range.from.toISOString(), to: range.to.toISOString() }),
    listApprovedNotScheduled(ctx),
  ]);

  const dayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const dateLabel = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  });
  const today = todayIn(now, zone);
  const byDay = new Map<string, typeof items>();
  for (const item of items) {
    const key = localDate(item.at, zone);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const postInfo = (item: (typeof items)[number]) => ({
    publicationId: item.publicationId,
    variantId: item.variantId,
    ideaId: item.ideaId,
    title: item.title,
    market: {
      code: item.market.code,
      name: item.market.name,
      flagEmoji: item.market.flagEmoji,
      timeZone: item.market.timeZone,
    },
    at: item.at.toISOString(),
    status: item.status,
    warnings: item.warnings,
    permalink: item.permalink,
  });
  const warningTitle = (codes: string[]) =>
    codes.map((c) => (t.warnings as Record<string, string>)[c] ?? c).join("\n");
  const nav = (change: Partial<CalendarFilters>) => calendarHref(filters, change);
  const link = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <main className="flex max-w-[110rem] flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground">{t.subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            className={link}
            href={nav({ week: addDays(range.monday, -7) })}
            aria-label={t.previous}
          >
            <ChevronLeftIcon />
          </Link>
          <Link className={link} href={nav({ week: undefined })}>
            {t.thisWeek}
          </Link>
          <Link className={link} href={nav({ week: addDays(range.monday, 7) })} aria-label={t.next}>
            <ChevronRightIcon />
          </Link>
          <span className="text-sm font-medium">
            {format(t.weekOf, { date: dateLabel(range.monday) })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <nav aria-label={t.title} className="flex gap-1.5">
            {(["week", "list"] as const).map((view) => (
              <Link
                key={view}
                href={nav({ view })}
                aria-current={filters.view === view ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 transition-colors hover:bg-muted",
                  filters.view === view && "border-foreground/30 bg-muted font-medium",
                )}
              >
                {t.views[view]}
              </Link>
            ))}
          </nav>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">{t.zoneLabel}</span>
            {markets.map((m) => (
              <Link
                key={m.code}
                href={nav({ zone: m.code })}
                aria-current={m.code === zoneMarket?.code ? "true" : undefined}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 transition-colors hover:bg-muted",
                  m.code === zoneMarket?.code && "border-foreground/30 bg-muted font-medium",
                )}
              >
                {m.flagEmoji ? <span aria-hidden="true">{m.flagEmoji} </span> : null}
                {offsetLabel(range.from, m.timezone)}
              </Link>
            ))}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4 min-[1700px]:flex-row min-[1700px]:items-start">
        <div className="min-w-0 flex-1">
          {filters.view === "week" ? (
            <div
              data-testid="week-grid"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4 min-[1700px]:grid-cols-7"
            >
              {range.days.map((date) => {
                const dayItems = byDay.get(date) ?? [];
                return (
                  <section
                    key={date}
                    data-date={date}
                    aria-label={dateLabel(date)}
                    className={cn(
                      "flex min-h-40 flex-col gap-1.5 rounded-lg border p-2",
                      date === today && "border-foreground/40 bg-muted/40",
                    )}
                  >
                    <h2 className="text-xs font-medium text-muted-foreground">
                      {dateLabel(date)}
                      {date === today ? ` · ${t.today}` : ""}
                    </h2>
                    {dayItems.map((item) => (
                      <PostButton
                        key={item.publicationId}
                        post={postInfo(item)}
                        canSchedule={canSchedule}
                        className={cn(
                          "flex min-w-0 flex-col gap-1 overflow-hidden rounded-md border border-l-4 bg-background p-2 text-left text-xs transition-colors hover:bg-muted",
                          MARKET_COLORS[item.market.order % MARKET_COLORS.length],
                        )}
                      >
                        <span className="flex items-center justify-between gap-1">
                          <span className="font-medium tabular-nums">
                            {clock(item.at, zone)}{" "}
                            {item.market.flagEmoji ? (
                              <span aria-hidden="true">{item.market.flagEmoji}</span>
                            ) : (
                              item.market.code
                            )}
                          </span>
                          {item.warnings.length > 0 ? (
                            <span title={warningTitle(item.warnings)}>
                              <AlertTriangleIcon
                                aria-hidden="true"
                                className="size-3.5 text-amber-600"
                              />
                              <span className="sr-only">{warningTitle(item.warnings)}</span>
                            </span>
                          ) : null}
                        </span>
                        {item.thumbnailUrl ? (
                          // biome-ignore lint/performance/noImgElement: presigned storage URL
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="aspect-[4/5] w-full rounded object-cover"
                            loading="lazy"
                          />
                        ) : null}
                        <span className="line-clamp-2">{item.title}</span>
                        <Badge variant="ghost" className={cn("w-fit", STATUS_STYLE[item.status])}>
                          {t.status[item.status]}
                        </Badge>
                      </PostButton>
                    ))}
                  </section>
                );
              })}
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {t.emptyList}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.list.time}</TableHead>
                    <TableHead>{t.list.market}</TableHead>
                    <TableHead className="min-w-64">{t.list.post}</TableHead>
                    <TableHead>{t.list.status}</TableHead>
                    <TableHead>{t.list.warnings}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.publicationId}>
                      <TableCell className="whitespace-nowrap">
                        <PostButton
                          post={postInfo(item)}
                          canSchedule={canSchedule}
                          className="underline-offset-4 hover:underline"
                        >
                          {dateTime.format(item.at)}
                        </PostButton>
                      </TableCell>
                      <TableCell>
                        {item.market.flagEmoji ? (
                          <span aria-hidden="true">{item.market.flagEmoji} </span>
                        ) : null}
                        {item.market.name}
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal">{item.title}</TableCell>
                      <TableCell>
                        <Badge variant="ghost" className={cn(STATUS_STYLE[item.status])}>
                          {t.status[item.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal text-xs text-muted-foreground">
                        {item.warnings
                          .map((c) => (t.warnings as Record<string, string>)[c] ?? c)
                          .join(" · ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {filters.view === "week" && items.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t.emptyWeek}</p>
          ) : null}
        </div>

        <aside
          aria-label={t.sidebar.title}
          data-testid="approved-sidebar"
          className="flex w-full flex-col gap-2 rounded-xl border bg-muted/30 p-3 min-[1700px]:w-80 min-[1700px]:shrink-0"
        >
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t.sidebar.title} <span className="tabular-nums">({waiting.length})</span>
          </h2>
          {waiting.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.sidebar.empty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {waiting.map((draft) => (
                <li
                  key={draft.variantId}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-md border border-l-4 bg-background p-2 text-sm",
                    MARKET_COLORS[draft.market.order % MARKET_COLORS.length],
                  )}
                >
                  <span className="font-medium">
                    {draft.market.flagEmoji ? (
                      <span aria-hidden="true">{draft.market.flagEmoji} </span>
                    ) : null}
                    {draft.market.name}
                  </span>
                  <Link
                    href={`/content/review/${draft.ideaId}`}
                    className="line-clamp-2 underline-offset-4 hover:underline"
                  >
                    {draft.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {format(t.sidebar.approved, {
                      date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                        draft.approvedAt,
                      ),
                    })}
                  </span>
                  <span>
                    <ScheduleButton
                      variantId={draft.variantId}
                      title={draft.title}
                      market={{
                        code: draft.market.code,
                        name: draft.market.name,
                        flagEmoji: draft.market.flagEmoji,
                        timeZone: draft.market.timeZone,
                      }}
                      canSchedule={canSchedule}
                    >
                      {t.sidebar.schedule}
                    </ScheduleButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}
