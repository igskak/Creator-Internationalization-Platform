import type { ReelInsights } from "@rc/modules/analytics";
import Link from "next/link";
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
import { compact, percent } from "./chart-math";
import { StatTile } from "./stat-tile";

// The Reels part of the Engagement tab (M8-10): watch time, hook rate and completion at D7, and
// each Reel next to the carousel it was made from. A number Instagram did not give is a dash.

type T = Messages["analytics"];
const NONE = "—";

export function ReelsSection({ reels, t, locale }: { reels: ReelInsights; t: T; locale: Locale }) {
  const r = t.reels;
  const { tiles } = reels;
  const seconds = (n: number | null) =>
    n === null
      ? NONE
      : format(r.seconds, {
          n: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n),
        });
  const pct = (n: number | null) => (n === null ? NONE : percent(n, locale));
  /** Shares of views: whole percents read better. */
  const whole = (n: number | null) => (n === null ? NONE : percent(n, locale, 0));
  const count = (n: number | null) => (n === null ? NONE : compact(n, locale));
  return (
    <section className="flex flex-col gap-3" aria-label={r.title} data-testid="reels-section">
      <div>
        <h2 className="text-base font-semibold">{r.title}</h2>
        <p className="text-sm text-muted-foreground">{r.subtitle}</p>
      </div>
      {tiles.reels === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {r.none}
        </p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <li>
              <StatTile
                testId="reels"
                label={r.reels}
                value={tiles.reels}
                hint={format(r.reelsHint, { measured: tiles.measured })}
              />
            </li>
            <li>
              <StatTile testId="reelViews" label={r.views} value={count(tiles.medianViews)} />
            </li>
            <li>
              <StatTile
                testId="avgWatch"
                label={r.avgWatch}
                value={seconds(tiles.medianAvgWatchSeconds)}
              />
            </li>
            <li>
              <StatTile
                testId="hookRate"
                label={r.hookRate}
                value={whole(tiles.medianHookRate)}
                hint={r.hookHint}
              />
            </li>
            <li>
              <StatTile
                testId="completion"
                label={r.completion}
                value={whole(tiles.medianCompletion)}
                hint={r.completionHint}
              />
            </li>
            <li>
              <StatTile
                testId="vsCarousel"
                label={r.vsCarousel}
                value={
                  tiles.medianReachVsCarousel === null
                    ? NONE
                    : format(r.times, {
                        x: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
                          tiles.medianReachVsCarousel,
                        ),
                      })
                }
                hint={r.vsCarouselHint}
              />
            </li>
          </ul>
          <div className="overflow-x-auto rounded-lg border">
            <Table data-testid="reels-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{r.table.reel}</TableHead>
                  <TableHead>{r.table.market}</TableHead>
                  <TableHead className="text-right">{r.table.views}</TableHead>
                  <TableHead className="text-right">{r.table.reach}</TableHead>
                  <TableHead className="text-right">{r.table.avgWatch}</TableHead>
                  <TableHead className="text-right">{r.table.hookRate}</TableHead>
                  <TableHead className="text-right">{r.table.completion}</TableHead>
                  <TableHead className="text-right">{r.table.saveRate}</TableHead>
                  <TableHead className="text-right">{r.table.carousel}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reels.reels.map((x) => (
                  <TableRow key={x.publicationId}>
                    <TableCell className="max-w-64">
                      <Link
                        href={`/content/published/${x.publicationId}`}
                        className="line-clamp-2 underline-offset-4 hover:underline"
                      >
                        {x.hook ?? x.publicationId.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>{x.marketCode}</TableCell>
                    <TableCell className="text-right tabular-nums">{count(x.views)}</TableCell>
                    <TableCell className="text-right tabular-nums">{count(x.reach)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {seconds(x.watch.avgWatchSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {whole(x.watch.hookRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {whole(x.watch.completion)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pct(x.saveRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {x.carousel ? (
                        <Link
                          href={`/content/published/${x.carousel.publicationId}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {count(x.carousel.reach)} / {pct(x.carousel.saveRate)}
                        </Link>
                      ) : (
                        NONE
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
