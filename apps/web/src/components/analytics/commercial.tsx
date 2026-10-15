import type {
  AttributionEventRow,
  AttributionImportEntry,
  Commercial,
  Money,
  UnknownCampaign,
} from "@rc/modules/analytics";
import Link from "next/link";
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
import { BarList } from "./bar-list";
import { compact } from "./chart-math";
import {
  AddAttributionDialog,
  DeleteAttributionButton,
  ImportAttributionDialog,
  type MarketOption,
  ReassignCampaignForm,
} from "./commercial-forms";
import { StatTile } from "./stat-tile";

// The Commercial tab of /analytics (plan 11 §11.4, M6-08): leads, sales, revenue and revenue per
// 1,000 reach in the window, the campaigns, sales by offer, the campaign ids no post has (with a
// form to move their events), the latest events and imports. Revenue stays per currency.

type T = Messages["analytics"];
const NONE = "—";

const moneyText = (values: Money[] | null, locale: Locale, empty = NONE) =>
  !values || values.length === 0
    ? empty
    : values
        .map((m) =>
          new Intl.NumberFormat(locale, {
            style: "currency",
            currency: m.currency,
            maximumFractionDigits: 2,
          }).format(m.amount),
        )
        .join(" · ");
const dateOf = (locale: Locale, at: Date) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(at);

export function CommercialTab({
  commercial,
  unknown,
  events,
  imports,
  markets,
  knownCampaigns,
  canEdit,
  isOwner,
  t,
  locale,
}: {
  commercial: Commercial;
  unknown: UnknownCampaign[];
  events: AttributionEventRow[];
  imports: AttributionImportEntry[];
  markets: MarketOption[];
  knownCampaigns: string[];
  canEdit: boolean;
  isOwner: boolean;
  t: T;
  locale: Locale;
}) {
  const c = t.commercial;
  const { totals } = commercial;
  return (
    <div className="flex flex-col gap-6">
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <AddAttributionDialog markets={markets} />
          <ImportAttributionDialog />
        </div>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <li>
          <StatTile
            testId="leads"
            label={c.leads}
            value={compact(totals.leads, locale)}
            hint={c.leadsHint}
          />
        </li>
        <li>
          <StatTile
            testId="sales"
            label={c.sales}
            value={compact(totals.sales, locale)}
            hint={format(c.salesHint, { refunds: totals.refunds })}
          />
        </li>
        <li>
          <StatTile
            testId="revenue"
            label={c.revenue}
            value={moneyText(totals.revenue, locale)}
            hint={c.revenueHint}
          />
        </li>
        <li>
          <StatTile
            testId="revenuePer1k"
            label={c.perReach}
            value={moneyText(totals.revenuePer1kReach, locale)}
            hint={
              totals.reachD7 === null
                ? undefined
                : format(c.perReachHint, { reach: compact(totals.reachD7, locale) })
            }
          />
        </li>
      </ul>

      <section className="flex flex-col gap-2" aria-label={c.campaigns}>
        <h2 className="text-sm font-medium">{c.campaigns}</h2>
        {commercial.campaigns.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {c.noRows}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table data-testid="campaigns-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{c.table.campaign}</TableHead>
                  <TableHead>{c.table.market}</TableHead>
                  <TableHead>{c.table.offer}</TableHead>
                  <TableHead className="text-right">{c.table.leads}</TableHead>
                  <TableHead className="text-right">{c.table.sales}</TableHead>
                  <TableHead className="text-right">{c.table.revenue}</TableHead>
                  <TableHead className="text-right">{c.table.reach}</TableHead>
                  <TableHead className="text-right">{c.table.perReach}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commercial.campaigns.map((row) => (
                  <TableRow key={`${row.campaignId ?? ""}|${row.marketCode}`}>
                    <TableCell className="max-w-72">
                      {row.campaignId === null ? (
                        <span className="text-muted-foreground">{c.noCampaign}</span>
                      ) : (
                        <span className="flex flex-col">
                          <span className="flex items-center gap-1.5 font-mono text-xs">
                            {row.campaignId}
                            {row.known ? null : <Badge variant="outline">{c.unknownBadge}</Badge>}
                          </span>
                          {row.hook ? (
                            row.publicationId ? (
                              <Link
                                href={`/content/published/${row.publicationId}`}
                                className="truncate text-sm underline-offset-4 hover:underline"
                              >
                                {row.hook}
                              </Link>
                            ) : (
                              <span className="truncate text-sm">{row.hook}</span>
                            )
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{row.marketCode}</TableCell>
                    <TableCell>{row.offerName ?? NONE}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.leads}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.sales}
                      {row.refunds > 0 ? (
                        <span className="text-muted-foreground"> (−{row.refunds})</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {moneyText(row.revenue, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.reachD7 === null ? NONE : compact(row.reachD7, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {moneyText(row.revenuePer1kReach, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label={c.byOffer}>
        <h2 className="text-sm font-medium">{c.byOffer}</h2>
        <BarList
          ariaLabel={c.byOffer}
          empty={c.noRows}
          rows={commercial.offers
            .filter((o) => o.sales > 0 || o.leads > 0)
            .map((o) => ({
              key: o.offerId ?? "none",
              label: o.offerName ?? c.noOffer,
              value: o.sales,
              display: `${o.sales} · ${moneyText(o.revenue, locale, c.noRevenue)}`,
              note: `${c.leads}: ${o.leads}`,
            }))}
        />
      </section>

      <section
        className="flex flex-col gap-2"
        aria-label={c.reconcile.title}
        data-testid="reconcile"
      >
        <h2 className="text-sm font-medium">{c.reconcile.title}</h2>
        {unknown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.reconcile.none}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{c.reconcile.hint}</p>
            <ul className="flex flex-col divide-y rounded-lg border">
              {unknown.map((u) => (
                <li
                  key={`${u.campaignId}|${u.marketCode}`}
                  className="flex flex-wrap items-center gap-3 p-3"
                >
                  <span className="flex min-w-56 flex-col">
                    <span className="font-mono text-xs">{u.campaignId}</span>
                    <span className="text-xs text-muted-foreground">
                      {u.marketCode} ·{" "}
                      {format(c.reconcile.events, { n: u.events, leads: u.leads, sales: u.sales })}{" "}
                      · {dateOf(locale, u.firstAt)}–{dateOf(locale, u.lastAt)}
                    </span>
                  </span>
                  {canEdit ? (
                    <ReassignCampaignForm from={u.campaignId} known={knownCampaigns} />
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-2" aria-label={c.recent}>
          <h2 className="text-sm font-medium">{c.recent}</h2>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{NONE}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-16 text-muted-foreground">{dateOf(locale, e.occurredAt)}</span>
                  <span className="w-20">
                    {c.types[e.type]}
                    {e.quantity > 1 ? ` ×${e.quantity}` : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {e.campaignId ?? NONE}
                  </span>
                  <span className="tabular-nums">
                    {e.amount === null || !e.currency
                      ? ""
                      : moneyText([{ currency: e.currency, amount: e.amount }], locale)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {(c.sources as Record<string, string>)[e.source] ?? e.source}
                  </span>
                  {isOwner ? <DeleteAttributionButton id={e.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-2" aria-label={c.import.last}>
          <h2 className="text-sm font-medium">{c.import.last}</h2>
          {imports.length === 0 ? (
            <p className="text-sm text-muted-foreground">{NONE}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border text-sm">
              {imports.map((i) => (
                <li key={i.batchId} className="flex flex-col px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {i.fileName ?? i.batchId.slice(0, 8)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dateOf(locale, i.requestedAt)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {i.report === null
                      ? c.import.running
                      : format(c.import.result, {
                          created: i.report.created,
                          duplicates: i.report.duplicates,
                          errors: i.report.errorCount,
                        })}
                    {i.report && i.report.unknownCampaigns > 0
                      ? ` · ${format(c.import.unknown, { n: i.report.unknownCampaigns })}`
                      : ""}
                  </span>
                  {i.report && i.report.errors.length > 0 ? (
                    <ul className="mt-1 text-xs text-destructive">
                      {i.report.errors.slice(0, 3).map((e) => (
                        <li key={`${e.row}-${e.field ?? ""}`}>
                          {e.row}: {e.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
