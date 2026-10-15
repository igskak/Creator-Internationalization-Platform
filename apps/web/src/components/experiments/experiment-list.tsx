import type { ExperimentListItem } from "@rc/modules/analytics";
import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import {
  type DimensionChoice,
  ExperimentDialog,
  ExperimentStatusButtons,
  type MarketChoice,
} from "./experiment-forms";

// The experiments of /experiments (M7-06): arms, status, results. A result is shown only when both
// arms have the minimum of posts with numbers at day 7; before that it says so.

type T = Messages["experiments"];

const STATUS_STYLE: Record<string, string> = {
  RUNNING: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  COMPLETED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  CANCELLED: "bg-muted text-muted-foreground",
  DRAFT: "bg-muted text-muted-foreground",
};

export function ExperimentList({
  experiments,
  markets,
  dimensions,
  canManage,
  t,
  locale,
}: {
  experiments: ExperimentListItem[];
  markets: MarketChoice[];
  dimensions: DimensionChoice[];
  canManage: boolean;
  t: T;
  locale: Locale;
}) {
  if (experiments.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{t.none}</p>
    );
  }
  const pct = (v: number | null) =>
    v === null
      ? "—"
      : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(v);
  const dimensionLabel = (d: string) => dimensions.find((x) => x.value === d)?.label ?? d;
  return (
    <ul className="flex flex-col gap-4">
      {experiments.map((x) => {
        const r = x.result;
        const hypothesis = markets
          .find((m) => m.id === x.marketId)
          ?.hypotheses.find((h) => h.id === x.visualHypothesisId);
        return (
          <li
            key={x.id}
            className="flex flex-col gap-3 rounded-xl border p-4"
            data-testid="experiment"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{x.name}</h2>
              <Badge variant="ghost" className={cn(STATUS_STYLE[x.status])}>
                {t.status[x.status]}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {x.marketCode ?? "—"} · {dimensionLabel(x.dimension)} · {t.metrics[x.primaryMetric]}
              </span>
            </div>
            <p className="text-sm">{x.hypothesis}</p>
            {hypothesis ? (
              <p className="text-xs text-muted-foreground">
                {t.form.visualHypothesis}: {hypothesis.description} ({hypothesis.status})
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {(["A", "B"] as const).map((arm) => {
                const value = arm === "A" ? x.variantA : x.variantB;
                const res = arm === "A" ? r.a : r.b;
                return (
                  <div key={arm} className="rounded-lg bg-muted/50 p-3 text-sm">
                    <p className="font-medium">{format(t.results.arm, { arm, value })}</p>
                    <p className="text-muted-foreground">
                      {format(t.results.posts, { n: res.n, assigned: res.assigned })} ·{" "}
                      {format(t.results.median, { value: pct(res.median) })}
                    </p>
                  </div>
                );
              })}
            </div>
            {r.sufficient ? (
              <p className="text-sm" data-testid="experiment-result">
                {format(t.results.difference, {
                  value: `${(r.difference ?? 0) >= 0 ? "+" : ""}${pct(r.difference)}`,
                })}{" "}
                · {format(t.results.p, { value: (r.pValue ?? 1).toFixed(3) })} ·{" "}
                <span className="text-muted-foreground">
                  {(r.pValue ?? 1) < 0.05 ? t.results.significant : t.results.notSignificant}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="experiment-result">
                {format(t.results.insufficient, { min: r.minPostsPerArm })}
              </p>
            )}
            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                {x.status === "DRAFT" ? (
                  <ExperimentDialog
                    markets={markets}
                    dimensions={dimensions}
                    initial={{
                      id: x.id,
                      name: x.name,
                      hypothesis: x.hypothesis,
                      marketId: x.marketId ?? "",
                      dimension: x.dimension,
                      variantA: x.variantA,
                      variantB: x.variantB,
                      primaryMetric: x.primaryMetric,
                      minPostsPerArm: x.minPostsPerArm,
                      visualHypothesisId: x.visualHypothesisId ?? "",
                      notes: x.notes ?? "",
                    }}
                  />
                ) : null}
                <ExperimentStatusButtons
                  id={x.id}
                  status={x.status}
                  hasHypothesis={Boolean(x.visualHypothesisId)}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
