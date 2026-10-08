import type { CriticReport } from "@rc/db/json";
import { Badge } from "@/components/ui/badge";
import { plural } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

type T = Messages["review"];

const SCORE_ORDER = [
  "factualFidelity",
  "sourceCoverage",
  "localization",
  "originality",
  "brandVoice",
  "structure",
  "cta",
  "overall",
] as const;

const VERDICT_STYLE: Record<string, string> = {
  PASS: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  REQUEST_REWRITE: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  FLAG_FOR_HUMAN: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};
const SEVERITY_STYLE: Record<string, string> = {
  BLOCKER: "text-destructive",
  MAJOR: "text-amber-700 dark:text-amber-300",
  MINOR: "text-muted-foreground",
};
const scoreStyle = (n: number) =>
  n <= 2 ? "text-destructive" : n < 4 ? "text-amber-700 dark:text-amber-300" : "text-foreground";

/** The critic's report of one draft: verdict, scores, unsupported claims and issues (plan 10 §10.3). */
export function CriticPanel({
  report,
  t,
  locale,
}: {
  report: CriticReport | null;
  t: T;
  locale: Locale;
}) {
  const c = t.critic;
  if (!report) {
    return (
      <section aria-label={c.title} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
        <h4 className="font-medium">{c.title}</h4>
        <p className="text-muted-foreground">{c.noReview}</p>
      </section>
    );
  }
  const noFindings =
    report.unsupportedClaims.length === 0 &&
    report.issues.length === 0 &&
    report.deterministicIssues.length === 0;
  return (
    <section aria-label={c.title} className="flex flex-col gap-3 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{c.title}</h4>
        <Badge variant="ghost" className={cn(VERDICT_STYLE[report.verdict])}>
          {c.verdict[report.verdict]}
        </Badge>
        {report.iteration > 0 ? (
          <span className="text-xs text-muted-foreground">
            {plural(locale, c.rewrites, report.iteration)}
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {SCORE_ORDER.map((name) => (
          <div key={name} className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">{c.scores[name]}</dt>
            <dd className={cn("font-medium tabular-nums", scoreStyle(report.scores[name]))}>
              {report.scores[name]}
            </dd>
          </div>
        ))}
      </dl>

      {report.humanAttention ? (
        <div role="note" className="rounded-md bg-red-50 p-2 dark:bg-red-950/40">
          <p className="font-medium">{c.humanAttention}</p>
          <p>{report.humanAttention}</p>
        </div>
      ) : null}

      {report.unsupportedClaims.length > 0 ? (
        <div>
          <p className="font-medium">{c.unsupported}</p>
          <ul className="flex flex-col gap-1.5">
            {report.unsupportedClaims.map((claim, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a static list of the report
              <li key={i}>
                “{claim.text}” <span className="text-muted-foreground">— {claim.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.issues.length > 0 ? (
        <div>
          <p className="font-medium">{c.issues}</p>
          <ul className="flex flex-col gap-1.5">
            {report.issues.map((issue, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a static list of the report
              <li key={i}>
                <span className={cn("font-medium", SEVERITY_STYLE[issue.severity])}>
                  {c.severity[issue.severity]}
                </span>{" "}
                {issue.explanation}
                {issue.suggestedFix ? (
                  <span className="text-muted-foreground"> → {issue.suggestedFix}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.deterministicIssues.length > 0 ? (
        <div>
          <p className="font-medium">{c.validators}</p>
          <ul className="flex flex-col gap-1.5">
            {report.deterministicIssues.map((issue, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a static list of the report
              <li key={i}>
                <span className={cn("font-medium", SEVERITY_STYLE[issue.severity])}>
                  {c.severity[issue.severity]}
                </span>{" "}
                <span className="font-mono text-xs">{issue.code}</span> {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {noFindings ? <p className="text-muted-foreground">{c.none}</p> : null}
    </section>
  );
}
