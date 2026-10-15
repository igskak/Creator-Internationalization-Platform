import type {
  ContentLearning,
  Engagement,
  Growth,
  Operations,
  RankedPost,
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
import { compact, percent } from "./chart-math";
import { LineChart } from "./line-chart";
import { StatTile } from "./stat-tile";

// The four tabs of /analytics (plan 10, M6-05 to M6-07). Server components: the data comes in as
// plain objects, the texts as the viewer's catalog. Only the line chart is a client component (its
// tooltip).

type T = Messages["analytics"];
const NONE = "—";

const dateOf = (locale: Locale, at: Date) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(at);
const rate = (value: number | null, locale: Locale) =>
  value === null ? NONE : percent(value, locale);

// --- Growth ------------------------------------------------------------------------------------

export function GrowthTab({ growth, t, locale }: { growth: Growth; t: T; locale: Locale }) {
  const g = t.growth;
  const { tiles } = growth;
  if (tiles.days === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{g.none}</p>
    );
  }
  const signed = (n: number) => `${n > 0 ? "+" : ""}${compact(n, locale)}`;
  const chart = {
    empty: t.chart.noData,
    tableLabel: t.chart.table,
    dateHeader: t.chart.date,
    valueHeader: t.chart.value,
  };
  return (
    <div className="flex flex-col gap-6">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <li>
          <StatTile
            testId="followers"
            label={g.followers}
            value={tiles.followers === null ? NONE : compact(tiles.followers, locale)}
            hint={g.followersHint}
          />
        </li>
        <li>
          <StatTile
            testId="followerGrowth"
            label={g.growth}
            value={tiles.followerGrowth === null ? NONE : signed(tiles.followerGrowth)}
            hint={g.growthHint}
          />
        </li>
        <li>
          <StatTile
            testId="avgDailyReach"
            label={g.reach}
            value={
              tiles.avgDailyReach === null ? NONE : compact(Math.round(tiles.avgDailyReach), locale)
            }
            hint={g.reachHint}
          />
        </li>
        <li>
          <StatTile
            testId="nonFollowerShare"
            label={g.share}
            value={
              tiles.nonFollowerShare === null ? NONE : percent(tiles.nonFollowerShare, locale, 0)
            }
            hint={g.shareHint}
          />
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">{format(g.days, { n: tiles.days })}</p>
      <div className="grid gap-8 lg:grid-cols-2">
        <LineChart
          title={g.followersChart}
          points={growth.followersSeries}
          kind="count"
          baseline="data"
          {...chart}
        />
        <LineChart title={g.reachChart} points={growth.reachSeries} kind="count" {...chart} />
        <LineChart
          title={g.shareChart}
          points={growth.nonFollowerShareSeries}
          kind="percent"
          series={2}
          {...chart}
        />
      </div>
    </div>
  );
}

// --- Engagement --------------------------------------------------------------------------------

export function EngagementTab({
  engagement,
  t,
  locale,
}: {
  engagement: Engagement;
  t: T;
  locale: Locale;
}) {
  const e = t.engagement;
  const { tiles } = engagement;
  return (
    <div className="flex flex-col gap-6">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <li>
          <StatTile
            testId="posts"
            label={e.posts}
            value={tiles.posts}
            hint={format(e.postsHint, { withRates: tiles.withRates, exact: tiles.exactD7 })}
          />
        </li>
        <li>
          <StatTile
            testId="saveRate"
            label={e.saveRate}
            value={rate(tiles.medianSaveRate, locale)}
          />
        </li>
        <li>
          <StatTile
            testId="shareRate"
            label={e.shareRate}
            value={rate(tiles.medianShareRate, locale)}
          />
        </li>
        <li>
          <StatTile
            testId="commentRate"
            label={e.commentRate}
            value={rate(tiles.medianCommentRate, locale)}
          />
        </li>
        <li>
          <StatTile
            testId="medianReach"
            label={e.medianReach}
            value={
              tiles.medianReach === null ? NONE : compact(Math.round(tiles.medianReach), locale)
            }
          />
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">{e.perReach}</p>
      {engagement.posts.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {e.noPosts}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-64">{e.table.post}</TableHead>
                <TableHead>{e.table.market}</TableHead>
                <TableHead>{e.table.published}</TableHead>
                <TableHead className="text-right">{e.table.reach}</TableHead>
                <TableHead className="text-right">{e.table.saves}</TableHead>
                <TableHead className="text-right">{e.table.shares}</TableHead>
                <TableHead className="text-right">{e.table.comments}</TableHead>
                <TableHead className="text-right">{e.table.engagement}</TableHead>
                <TableHead>{e.table.measured}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {engagement.posts.map((p) => (
                <TableRow key={p.publicationId} data-post={p.publicationId}>
                  <TableCell className="max-w-sm whitespace-normal">
                    <Link
                      href={`/content/published/${p.publicationId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {p.hook ?? p.publicationId.slice(0, 8)}
                    </Link>
                    <span className="ml-2 inline-flex gap-1 align-middle">
                      <Badge variant="secondary">
                        {(t.formats as Record<string, string>)[p.format] ?? p.format}
                      </Badge>
                    </span>
                  </TableCell>
                  <TableCell>{p.marketCode}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {dateOf(locale, p.publishedAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.metrics?.reach == null ? NONE : compact(p.metrics.reach, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(p.metrics?.saveRate ?? null, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(p.metrics?.shareRate ?? null, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(p.metrics?.commentRate ?? null, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate(p.metrics?.engagementRate ?? null, locale)}
                  </TableCell>
                  <TableCell>
                    {p.metrics === null ? (
                      <span className="text-muted-foreground">{e.noNumbers}</span>
                    ) : p.metrics.isExactD7 ? (
                      format(e.measuredAt, { days: Math.round(p.metrics.ageHours / 24) })
                    ) : (
                      <Badge variant="outline">
                        {format(e.fallback, { slot: p.metrics.slot })}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// --- Content learning --------------------------------------------------------------------------

export type LearningLabels = {
  /** The label of a value of the chosen dimension (taxonomy label, offer name, weekday, daypart…). */
  value: (value: string) => string;
};

export function LearningTab({
  learning,
  ranked,
  t,
  locale,
  labels,
  thumbnails = true,
}: {
  learning: ContentLearning;
  ranked: { top: RankedPost[]; bottom: RankedPost[]; considered: number };
  t: T;
  locale: Locale;
  labels: LearningLabels;
  thumbnails?: boolean;
}) {
  const l = t.learning;
  const dimension =
    (l.dimensions as Record<string, string>)[learning.dimension] ?? learning.dimension;
  if (learning.rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        {l.noRows}
      </p>
    );
  }
  const lift = (x: number | null) => (x === null ? NONE : `${x.toFixed(2)}×`);
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2" aria-label={format(l.chart, { dimension })}>
        <h2 className="text-sm font-medium">{format(l.chart, { dimension })}</h2>
        <p className="text-xs text-muted-foreground">
          {format(l.marketLine, {
            save: rate(learning.market.medianSaveRate, locale),
            n: learning.market.n,
          })}{" "}
          {format(l.dimensionHint, { min: learning.minSample })}
        </p>
        <BarList
          ariaLabel={format(l.chart, { dimension })}
          empty={l.noRows}
          rows={learning.rows.map((r) => ({
            key: r.value,
            label: labels.value(r.value),
            value: r.medianSaveRate ?? 0,
            display:
              r.medianSaveRate === null
                ? NONE
                : `${percent(r.medianSaveRate, locale)}${r.liftVsMarket === null ? "" : ` · ${format(l.lift, { x: r.liftVsMarket.toFixed(2) })}`}`,
            note: `${format(l.posts, { n: r.n })}${r.lowSample ? ` · ${l.lowSample}` : ""}`,
            muted: r.lowSample,
          }))}
        />
      </section>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{l.table.value}</TableHead>
              <TableHead className="text-right">{l.table.posts}</TableHead>
              <TableHead className="text-right">{l.table.save}</TableHead>
              <TableHead className="text-right">{l.table.share}</TableHead>
              <TableHead className="text-right">{l.table.reach}</TableHead>
              <TableHead className="text-right">{l.table.lift}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {learning.rows.map((r) => (
              <TableRow key={r.value} data-group={r.value}>
                <TableCell>
                  {labels.value(r.value)}
                  {r.lowSample ? (
                    <Badge variant="outline" className="ml-2">
                      {l.lowSample}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.n}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {rate(r.medianSaveRate, locale)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {rate(r.medianShareRate, locale)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.medianReach === null ? NONE : compact(Math.round(r.medianReach), locale)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{lift(r.liftVsMarket)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{l.rankingNote}</p>
        <div className="grid gap-6 lg:grid-cols-2">
          <RankedList
            title={l.top}
            posts={ranked.top}
            empty={l.noPosts}
            locale={locale}
            t={t}
            thumbnails={thumbnails}
          />
          <RankedList
            title={l.bottom}
            posts={ranked.bottom}
            empty={l.noPosts}
            locale={locale}
            t={t}
            thumbnails={thumbnails}
          />
        </div>
      </div>
    </div>
  );
}

function RankedList({
  title,
  posts,
  empty,
  locale,
  t,
  thumbnails,
}: {
  title: string;
  posts: RankedPost[];
  empty: string;
  locale: Locale;
  t: T;
  thumbnails: boolean;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {posts.map((p) => (
            <li key={p.publicationId} data-ranked={p.publicationId}>
              <Link
                href={`/content/published/${p.publicationId}`}
                className="flex items-center gap-3 rounded-lg border p-2 hover:bg-muted"
              >
                {thumbnails && p.thumbnailUrl ? (
                  // biome-ignore lint/performance/noImgElement: presigned storage URL
                  <img
                    src={p.thumbnailUrl}
                    alt=""
                    className="h-16 w-12 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="h-16 w-12 shrink-0 rounded bg-muted" aria-hidden="true" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {p.hook ?? p.publicationId.slice(0, 8)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.marketCode} · {(t.formats as Record<string, string>)[p.format] ?? p.format} ·{" "}
                    {dateOf(locale, p.publishedAt)}
                  </span>
                </span>
                <span className="ml-auto text-sm font-semibold tabular-nums">
                  {percent(p.value, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// --- Operations --------------------------------------------------------------------------------

export function OperationsTab({
  operations,
  t,
  locale,
  reasonLabels,
}: {
  operations: Operations;
  t: T;
  locale: Locale;
  reasonLabels: Record<string, string>;
}) {
  const o = t.operations;
  const num = (n: number | null, digits = 1) =>
    n === null ? NONE : new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  const money = (n: number | null) =>
    n === null
      ? NONE
      : new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(n);
  return (
    <div className="flex flex-col gap-6">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <StatTile
            testId="generated"
            label={o.generated}
            value={operations.generated}
            hint={o.generatedHint}
          />
        </li>
        <li>
          <StatTile
            testId="approvalRate"
            label={o.approvalRate}
            value={
              operations.approvalRate === null ? NONE : percent(operations.approvalRate, locale, 0)
            }
            hint={format(o.approvalHint, {
              approved: operations.approved,
              rejected: operations.rejected,
            })}
          />
        </li>
        <li>
          <StatTile
            testId="edits"
            label={o.edits}
            value={num(operations.avgEditsPerApproved)}
            hint={o.editsHint}
          />
        </li>
        <li>
          <StatTile
            testId="timeToApprove"
            label={o.timeToApprove}
            value={
              operations.medianTimeToApproveHours === null
                ? NONE
                : format(o.hours, { n: num(operations.medianTimeToApproveHours) })
            }
            hint={o.timeHint}
          />
        </li>
        <li>
          <StatTile
            testId="criticPass"
            label={o.criticPass}
            value={
              operations.criticPassRate === null
                ? NONE
                : percent(operations.criticPassRate, locale, 0)
            }
            hint={format(o.criticHint, { n: operations.criticReports })}
          />
        </li>
        <li>
          <StatTile
            testId="regenerations"
            label={o.regenerations}
            value={num(operations.regenerationsPerVariant, 2)}
          />
        </li>
        <li>
          <StatTile
            testId="cost"
            label={o.cost}
            value={money(operations.costPerApprovedPost)}
            hint={o.costHint}
          />
        </li>
      </ul>
      <section className="flex flex-col gap-2" aria-label={o.reasons}>
        <h2 className="text-sm font-medium">{o.reasons}</h2>
        <BarList
          ariaLabel={o.reasons}
          empty={o.noReasons}
          rows={operations.rejectionReasons.map((r) => ({
            key: r.code,
            label: reasonLabels[r.code] ?? r.code,
            value: r.count,
            display: String(r.count),
          }))}
        />
      </section>
    </div>
  );
}
