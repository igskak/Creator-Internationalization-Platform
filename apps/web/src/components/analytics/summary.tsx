import type { PerformancePattern } from "@rc/db/json";
import type { StoredSummary } from "@rc/modules/analytics";
import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { BuildSummaryButton } from "./build-summary-button";

// The Learning summary tab of /analytics (plan 10, M7-03): the newest performance memory of the
// market, or across markets, as the idea generator and the writer read it. Nothing is computed
// here: the page shows what J15 stored.

type T = Messages["analytics"];

const dateOf = (locale: Locale, at: Date | string) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(typeof at === "string" ? new Date(`${at}T00:00:00Z`) : at);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border p-4" aria-label={title}>
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

export function SummaryTab({
  summary,
  canBuild,
  labels,
  reasonLabels,
  t,
  locale,
}: {
  summary: StoredSummary | null;
  canBuild: boolean;
  /** The label of a dimension value (taxonomy codes, dayparts). */
  labels: { value: (dimension: string, value: string) => string };
  reasonLabels: Record<string, string>;
  t: T;
  locale: Locale;
}) {
  const s = t.summary;
  const nothing = <p className="text-sm text-muted-foreground">{s.nothing}</p>;
  const dimensionName = (d: string) => (t.learning.dimensions as Record<string, string>)[d] ?? d;
  const patterns = (rows: PerformancePattern[], testId: string) =>
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">{s.noPatterns}</p>
    ) : (
      <ul className="flex flex-col gap-2" data-testid={testId}>
        {rows.map((p) => (
          <li
            key={`${p.dimension}|${p.value}|${p.metric}`}
            className="flex flex-wrap items-baseline gap-x-2 text-sm"
          >
            <span className="text-muted-foreground">{dimensionName(p.dimension)}:</span>
            <span className="font-medium">{labels.value(p.dimension, p.value)}</span>
            <span className="tabular-nums">
              {format(s.lift, {
                x: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(p.lift),
              })}{" "}
              · {s.metrics[p.metric]}
            </span>
            <span className="text-xs text-muted-foreground">
              {format(s.posts, { n: p.n })} · {s.confidence[p.confidence]}
            </span>
          </li>
        ))}
      </ul>
    );

  if (!summary) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
        <p className="text-sm text-muted-foreground">{s.none}</p>
        {canBuild ? <BuildSummaryButton /> : null}
      </div>
    );
  }
  const m = summary.memory;
  const days =
    Math.round(
      (new Date(`${m.window.to}T00:00:00Z`).getTime() -
        new Date(`${m.window.from}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm">
            {format(s.built, {
              date: dateOf(locale, summary.createdAt),
              days,
              from: dateOf(locale, m.window.from),
              to: dateOf(locale, m.window.to),
              n: m.basis.publications,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {m.marketCode === "ALL" ? `${s.across} ` : ""}
            {s.usedBy}
          </p>
        </div>
        {canBuild ? <BuildSummaryButton /> : null}
      </div>

      {m.caveats.length > 0 ? (
        <aside
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
          aria-label={s.caveats}
        >
          <p className="font-medium">{s.caveats}</p>
          <ul className="mt-1 list-disc pl-5">
            {m.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </aside>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={s.top}>{patterns(m.topPatterns, "top-patterns")}</Section>
        <Section title={s.weak}>{patterns(m.weakPatterns, "weak-patterns")}</Section>
        <Section title={s.overused}>
          {m.overusedThemes.length === 0 ? (
            nothing
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {m.overusedThemes.map((o) => (
                <li key={`${o.category}|${o.angle ?? ""}`}>
                  <span className="font-medium">{labels.value("category", o.category)}</span>
                  {o.angle ? <> · {labels.value("angle", o.angle)}</> : null}{" "}
                  <span className="text-muted-foreground">
                    {format(s.overusedItem, { count: o.count, days: o.windowDays })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={s.gaps}>
          {m.coverageGaps.length === 0 ? (
            nothing
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {m.coverageGaps.map((g) => (
                <li key={g.category}>
                  <span className="font-medium">{labels.value("category", g.category)}</span>{" "}
                  <span className="text-muted-foreground">
                    {format(s.gapItem, { cards: g.approvedCards })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={s.untested}>
          {m.untestedHypotheses.length === 0 ? (
            nothing
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {m.untestedHypotheses.map((u) => (
                <li
                  key={`${u.source}|${u.description}`}
                  className="flex flex-wrap items-baseline gap-2"
                >
                  <Badge variant="outline">{s.untestedSources[u.source]}</Badge>
                  <span>{u.description}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={s.offers}>
          {m.offerPriorities.length === 0 ? (
            nothing
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {m.offerPriorities.map((o) => (
                <li key={o.offerId}>
                  <span className="font-medium">{o.productCode}</span>{" "}
                  <span className="text-muted-foreground">
                    {format(s.offerItem, { priority: o.priority })}
                    {o.leads !== undefined || o.sales !== undefined
                      ? ` · ${format(s.offerResults, { leads: o.leads ?? 0, sales: o.sales ?? 0 })}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title={s.feedback}>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{s.reasons}</h3>
            {m.feedback.topRejectionReasons.length === 0 ? (
              nothing
            ) : (
              <ul className="text-sm">
                {m.feedback.topRejectionReasons.map((r) => (
                  <li key={r.code}>
                    {reasonLabels[r.code] ?? r.code}{" "}
                    <span className="text-muted-foreground">× {r.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{s.fields}</h3>
            {m.feedback.mostEditedFields.length === 0 ? (
              nothing
            ) : (
              <ul className="text-sm">
                {m.feedback.mostEditedFields.map((f) => (
                  <li key={f.field}>
                    <code className="text-xs">{f.field}</code>{" "}
                    <span className="text-muted-foreground">× {f.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{s.rewrites}</h3>
            {m.feedback.hookRewrites.length === 0 ? (
              nothing
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {m.feedback.hookRewrites.map((h) => (
                  <li key={`${h.original}|${h.edited}`}>
                    <span className="text-muted-foreground line-through">{h.original}</span>
                    <br />
                    {h.edited}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
