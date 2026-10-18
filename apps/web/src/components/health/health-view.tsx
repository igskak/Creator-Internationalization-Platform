import type { HealthState, JobDomain, StuckItem, SystemHealth } from "@rc/modules/health";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

// System health (plan 10 §10.2, 12 §12.9, H-01): the tiles of the dashboard and the sections of
// /settings/health. Server components: the data is read on the server and passed as it is. A
// state is never colour alone: the badge says it in words, and each section says its rule.

type T = Messages["systemHealth"];

export const INDICATORS = [
  "connectivity",
  "instagram",
  "publishing",
  "jobs",
  "insights",
  "aiProviders",
  "aiCost",
] as const;
export type IndicatorKey = (typeof INDICATORS)[number];

const DOMAINS: readonly JobDomain[] = [
  "INGESTION",
  "GENERATION",
  "PICTURES",
  "RENDERS",
  "PUBLISHING",
];

const STATE_STYLE: Record<HealthState, string> = {
  NONE: "bg-muted text-muted-foreground",
  GREEN: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  AMBER: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  RED: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};
const BORDER: Record<HealthState, string> = {
  NONE: "",
  GREEN: "",
  AMBER: "border-amber-400/60",
  RED: "border-destructive/50",
};

export function StateBadge({ state, t }: { state: HealthState; t: T }) {
  return (
    <Badge variant="ghost" className={cn(STATE_STYLE[state])} data-state={state}>
      {t.state[state]}
    </Badge>
  );
}

const stateOf = (health: SystemHealth, key: IndicatorKey): HealthState => health[key].state;

const dateTime = (locale: Locale, at: Date) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(at);

const usd = (locale: Locale, n: number) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);

const probeText = (p: SystemHealth["connectivity"]["db"], t: T) =>
  !p.configured
    ? t.connectivity.notConfigured
    : !p.ok
      ? t.connectivity.failing
      : format(t.connectivity.ms, { ms: p.ms ?? 0 });

const instagramReason = (a: SystemHealth["instagram"]["accounts"][number], t: T) =>
  a.reason === "EXPIRING"
    ? format(t.instagram.reason.EXPIRING, { days: Math.max(0, a.daysLeft ?? 0) })
    : a.reason === "QUOTA" && a.quota
      ? format(t.instagram.reason.QUOTA, a.quota)
      : t.instagram.reason[a.reason];

/** One line per indicator, for the tiles and the section headers. */
export function summary(health: SystemHealth, key: IndicatorKey, t: T, locale: Locale): string {
  switch (key) {
    case "connectivity":
      return `${t.connectivity.db}: ${probeText(health.connectivity.db, t)} · ${t.connectivity.storage}: ${probeText(health.connectivity.storage, t)}`;
    case "instagram":
      return health.instagram.accounts
        .map((a) => `${a.flagEmoji ?? a.marketCode} ${instagramReason(a, t)}`)
        .join(" · ");
    case "publishing": {
      const p = health.publishing;
      const parts = [t.publishing.mode[p.mode], p.enabled ? t.publishing.on : t.publishing.off];
      if (p.failed7d > 0) parts.push(format(t.publishing.failed, { count: p.failed7d }));
      if (p.waiting > 0) parts.push(format(t.publishing.waiting, { count: p.waiting }));
      return parts.join(" · ");
    }
    case "jobs": {
      const total = DOMAINS.reduce((s, d) => s + health.jobs.failed24h[d], 0);
      return `${format(t.jobs.total, { count: total })} · ${format(t.jobs.stuckCount, { count: health.jobs.stuck.length })}`;
    }
    case "insights":
      return health.insights.oldestLagHours === null
        ? t.insights.none
        : format(t.insights.due, {
            count: health.insights.due,
            hours: Math.max(0, Math.round(health.insights.oldestLagHours)),
          });
    case "aiProviders":
      return format(t.aiProviders.summary, health.aiProviders);
    case "aiCost": {
      const c = health.aiCost;
      const spent = format(t.aiCost.spent, { spent: usd(locale, c.monthToDateUsd) });
      return c.budgetUsd === null
        ? `${spent} · ${t.aiCost.noBudget}`
        : `${spent} ${format(t.aiCost.of, { budget: usd(locale, c.budgetUsd) })}`;
    }
  }
}

/** The dashboard's health tiles: one per indicator, each opening its section of /settings/health. */
export function HealthTiles({ health, t, locale }: { health: SystemHealth; t: T; locale: Locale }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {INDICATORS.map((key) => {
        const state = stateOf(health, key);
        return (
          <li key={key}>
            <Link
              href={`/settings/health#${key}`}
              data-indicator={key}
              className={cn(
                "flex h-full flex-col gap-2 rounded-xl border p-4 transition-colors hover:bg-muted",
                BORDER[state],
              )}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{t.indicators[key]}</span>
                <StateBadge state={state} t={t} />
              </span>
              <span className="text-sm text-muted-foreground">
                {summary(health, key, t, locale)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Section({
  id,
  health,
  t,
  locale,
  children,
}: {
  id: IndicatorKey;
  health: SystemHealth;
  t: T;
  locale: Locale;
  children?: ReactNode;
}) {
  const state = stateOf(health, id);
  return (
    <section
      id={id}
      aria-label={t.indicators[id]}
      data-indicator={id}
      className={cn("flex scroll-mt-6 flex-col gap-3 rounded-lg border p-4", BORDER[state])}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t.indicators[id]}</h2>
        <StateBadge state={state} t={t} />
      </header>
      <p className="text-sm">{summary(health, id, t, locale)}</p>
      {children}
      <p className="text-xs text-muted-foreground">{t.rules[id]}</p>
    </section>
  );
}

const stuckHref = (item: StuckItem): string | null =>
  item.sourceId
    ? `/knowledge/sources/${item.sourceId}`
    : item.ideaId
      ? `/content/review/${item.ideaId}`
      : null;

/** /settings/health: every indicator with its details, the open findings and recent activity. */
export function HealthReport({
  health,
  t,
  locale,
  killSwitch,
}: {
  health: SystemHealth;
  t: T;
  locale: Locale;
  /** The owner's kill switch (a client component), shown under Publishing. */
  killSwitch?: ReactNode;
}) {
  const failure = health.publishing.lastFailure;
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t.overall}:</span>
        <StateBadge state={health.overall} t={t} />
        <span className="text-muted-foreground">
          {format(t.checkedAt, { time: dateTime(locale, health.checkedAt) })}
        </span>
      </p>

      <Section id="connectivity" health={health} t={t} locale={locale} />

      <Section id="instagram" health={health} t={t} locale={locale}>
        <ul className="flex flex-col gap-2">
          {health.instagram.accounts.map((a) => (
            <li
              key={a.marketId}
              data-market={a.marketCode}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span>
                {a.flagEmoji ?? ""} {a.marketName}
                {a.username ? ` · @${a.username}` : ""}
              </span>
              <StateBadge state={a.state} t={t} />
              <span>{instagramReason(a, t)}</span>
              <span className="text-muted-foreground">
                {a.lastCheckAt
                  ? format(t.instagram.lastCheck, { time: dateTime(locale, a.lastCheckAt) })
                  : a.username
                    ? t.instagram.never
                    : ""}
              </span>
            </li>
          ))}
        </ul>
        <Link className="text-sm underline" href="/settings/instagram">
          {t.instagram.manage}
        </Link>
      </Section>

      <Section id="publishing" health={health} t={t} locale={locale}>
        {failure ? (
          <p className="text-sm">
            {format(t.publishing.lastFailure, { time: dateTime(locale, failure.at) })}:{" "}
            {failure.message ?? t.publishing.noMessage}{" "}
            {failure.ideaId ? (
              <Link className="underline" href={`/content/review/${failure.ideaId}`}>
                {t.publishing.open}
              </Link>
            ) : null}
          </p>
        ) : null}
        {killSwitch}
      </Section>

      <Section id="jobs" health={health} t={t} locale={locale}>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t.jobs.failed}</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={t.jobs.failed}>
            {DOMAINS.map((d) => (
              <li key={d} data-domain={d}>
                {t.jobs.domain[d]}:{" "}
                <span className="font-semibold tabular-nums">{health.jobs.failed24h[d]}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t.jobs.stuck}</h3>
          {health.jobs.stuck.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.jobs.noStuck}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" aria-label={t.jobs.stuck}>
              {health.jobs.stuck.map((item) => {
                const href = stuckHref(item);
                return (
                  <li key={`${item.kind}:${item.id}`} data-stuck={item.kind}>
                    {t.jobs.kind[item.kind]}
                    {item.marketCode ? ` · ${item.marketCode}` : ""} ·{" "}
                    {format(t.jobs.since, { time: dateTime(locale, item.since) })}
                    {href ? (
                      <>
                        {" "}
                        <Link className="underline" href={href}>
                          {t.jobs.open}
                        </Link>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Section>

      <Section id="insights" health={health} t={t} locale={locale}>
        {health.insights.late.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {health.insights.late.map((l) => (
              <li key={`${l.kind}:${l.id}:${l.label}`} data-late={l.kind}>
                {format(t.insights.kind[l.kind], { label: l.label })}
                {l.marketCode ? ` · ${l.marketCode}` : ""} ·{" "}
                {format(t.insights.lateBy, { hours: Math.max(0, Math.round(l.lagHours)) })}{" "}
                <Link
                  className="underline"
                  href={l.kind === "POST" ? `/content/published/${l.id}` : "/settings/instagram"}
                >
                  {t.jobs.open}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section id="aiProviders" health={health} t={t} locale={locale} />

      <Section id="aiCost" health={health} t={t} locale={locale}>
        <Link className="text-sm underline" href="/settings/ai">
          {t.aiCost.manage}
        </Link>
      </Section>

      <section aria-label={t.problems.title} className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">{t.problems.title}</h2>
        {health.problems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.problems.none}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {health.problems.map((p) => (
              <li key={p.id} data-severity={p.severity}>
                <span className="font-medium">{p.integration}</span> · {p.code} · {p.message}{" "}
                <span className="text-muted-foreground">{dateTime(locale, p.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t.activity.title} className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">{t.activity.title}</h2>
        {health.activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.activity.none}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {health.activity.map((a) => (
              <li key={a.id}>
                <span className="text-muted-foreground">{dateTime(locale, a.occurredAt)}</span> ·{" "}
                <code className="text-xs">{a.action}</code> · {t.activity.actor[a.actorType]}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
