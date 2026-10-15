import type { AiCostOverview } from "@rc/modules/ai";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { AiBudgetForm } from "./ai-budget";

// /settings/ai (plan 10, H-05): the budget with its state, the month's cost by stage and the active
// configuration of every stage. The state is never colour alone: the badge says it in words.

type T = Messages["aiSettings"];

const STATE_STYLE: Record<string, string> = {
  NONE: "bg-muted text-muted-foreground",
  GREEN: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  AMBER: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  RED: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export function AiOverview({
  overview,
  isOwner,
  t,
  locale,
}: {
  overview: AiCostOverview;
  isOwner: boolean;
  t: T;
  locale: Locale;
}) {
  const usd = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(n);
  const month = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${overview.month}-01T00:00:00Z`));
  const share = overview.share === null ? 0 : Math.min(1, overview.share);
  return (
    <div className="flex flex-col gap-6">
      <section
        className="flex flex-col gap-3 rounded-lg border p-4"
        aria-label={t.budget.title}
        data-testid="ai-budget"
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t.budget.title}</h2>
          <Badge variant="ghost" className={cn(STATE_STYLE[overview.state])}>
            {t.budget.state[overview.state]}
          </Badge>
        </header>
        <p className="text-sm">
          {format(t.budget.spent, { month })}:{" "}
          <span className="text-2xl font-semibold tabular-nums">
            {usd(overview.monthToDateUsd)}
          </span>{" "}
          {overview.budgetUsd !== null ? (
            <span className="text-muted-foreground">
              {format(t.budget.of, { budget: usd(overview.budgetUsd) })}
            </span>
          ) : null}
        </p>
        {overview.budgetUsd !== null ? (
          <div
            className="h-2 w-full max-w-md overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((overview.share ?? 0) * 100)}
            aria-label={t.budget.title}
          >
            <div
              className={cn(
                "h-full rounded-full bg-foreground/70",
                overview.state === "AMBER" && "bg-amber-500",
                overview.state === "RED" && "bg-red-600",
              )}
              style={{ width: `${share * 100}%` }}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.budget.noBudget}</p>
        )}
        <p className="text-xs text-muted-foreground">{t.budget.hint}</p>
        {isOwner ? (
          <AiBudgetForm budgetUsd={overview.budgetUsd} />
        ) : (
          <p className="text-sm text-muted-foreground">{t.budget.ownersOnly}</p>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label={t.byStage.title}>
        <h2 className="text-lg font-semibold">{t.byStage.title}</h2>
        {overview.byStage.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.byStage.none}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table data-testid="cost-by-stage">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.byStage.stage}</TableHead>
                  <TableHead className="text-right">{t.byStage.runs}</TableHead>
                  <TableHead className="text-right">{t.byStage.failed}</TableHead>
                  <TableHead className="text-right">{t.byStage.cost}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.byStage.map((s) => (
                  <TableRow key={s.stage}>
                    <TableCell className="font-mono text-xs">{s.stage}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.runs}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.failed}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(s.costUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{format(t.day, overview.last24h)}</p>
      </section>

      <section className="flex flex-col gap-2" aria-label={t.stages.title}>
        <h2 className="text-lg font-semibold">{t.stages.title}</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="stage-config">
            <TableHeader>
              <TableRow>
                <TableHead>{t.stages.stage}</TableHead>
                <TableHead>{t.stages.prompt}</TableHead>
                <TableHead>{t.stages.model}</TableHead>
                <TableHead>{t.stages.effort}</TableHead>
                <TableHead className="text-right">{t.stages.maxTokens}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.stages.map((s) => (
                <TableRow key={s.stage}>
                  <TableCell className="font-mono text-xs">{s.stage}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {s.promptId}@{s.version}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.model}</TableCell>
                  <TableCell>{s.effort}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.maxTokens.toLocaleString(locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
