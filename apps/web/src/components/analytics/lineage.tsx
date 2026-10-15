import type { Lineage } from "@rc/modules/analytics";
import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
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
import { compact, percent } from "./chart-math";
import { CollectNowButton } from "./collect-now-button";
import { LineChart } from "./line-chart";
import { StatTile } from "./stat-tile";

// The lineage screen of one post (plan 04 §4.6, M6-09): the chain from the source to the numbers,
// and the numbers themselves. A server component; the Reel card and the collect button are passed in.

type T = Messages["lineage"];
const NONE = "—";

const Section = ({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) => (
  <section className="flex flex-col gap-2" data-section={testId} aria-label={title}>
    <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
    {children}
  </section>
);

export function LineageView({
  lineage,
  t,
  locale,
  canManage,
  reelCard,
}: {
  lineage: Lineage;
  t: T;
  locale: Locale;
  canManage: boolean;
  /** The Reel card of a carousel (made from it, or the button to make one). */
  reelCard?: ReactNode;
}) {
  const { publication, market, variant, idea, cards, brief, version, metrics } = lineage;
  const when = (at: Date | null) =>
    at
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: market.timeZone,
        }).format(at)
      : NONE;
  const rate = (v: number | null) => (v === null ? NONE : percent(v, locale));
  const count = (v: number | null) => (v === null ? NONE : compact(v, locale));
  const n = t.numbers;
  const c = t.chain;
  const d7 = metrics.d7;
  const dayLabel = (hours: number) => Math.round(hours / 24);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-semibold">{variant.hook ?? idea.topic}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">
              {(t.format as Record<string, string>)[variant.format] ?? variant.format}
            </Badge>
            <span>
              {format(t.published, {
                when: when(publication.publishedAt),
                market: `${market.flagEmoji ? `${market.flagEmoji} ` : ""}${market.name}`,
              })}
            </span>
            {publication.accountUsername ? (
              <span>{format(t.account, { name: publication.accountUsername })}</span>
            ) : null}
          </p>
          {publication.permalink ? (
            <a
              href={publication.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-sm underline underline-offset-4"
            >
              {t.openOnInstagram} <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">{t.notPublished}</p>
          )}
        </div>
        <CollectNowButton publicationId={publication.id} canManage={canManage} />
      </header>

      <Section title={n.title} testId="numbers">
        {d7 ? (
          <>
            <p className="text-sm text-muted-foreground">
              {d7.isExactD7
                ? n.d7
                : format(n.fallback, { slot: d7.slot, days: dayLabel(d7.ageHours) })}
            </p>
            <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <li>
                <StatTile testId="reach" label={n.reach} value={count(d7.reach)} />
              </li>
              <li>
                <StatTile testId="saves" label={n.saves} value={count(d7.saves)} />
              </li>
              <li>
                <StatTile testId="shares" label={n.shares} value={count(d7.shares)} />
              </li>
              <li>
                <StatTile testId="saveRate" label={n.saveRate} value={rate(d7.saveRate)} />
              </li>
              <li>
                <StatTile testId="shareRate" label={n.shareRate} value={rate(d7.shareRate)} />
              </li>
              <li>
                <StatTile
                  testId="engagementRate"
                  label={n.engagementRate}
                  value={rate(d7.engagementRate)}
                />
              </li>
            </ul>
          </>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {n.none}
          </p>
        )}
        {metrics.watch && d7 ? (
          <ul
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            aria-label={n.watch}
            data-testid="watch"
          >
            <li>
              <StatTile
                testId="avgWatch"
                label={n.avgWatch}
                value={
                  metrics.watch.avgWatchSeconds === null
                    ? "—"
                    : format(n.seconds, { n: Math.round(metrics.watch.avgWatchSeconds * 10) / 10 })
                }
              />
            </li>
            <li>
              <StatTile testId="hookRate" label={n.hookRate} value={rate(metrics.watch.hookRate)} />
            </li>
            <li>
              <StatTile
                testId="completion"
                label={n.completion}
                value={rate(metrics.watch.completion)}
              />
            </li>
            <li>
              <StatTile
                testId="totalWatch"
                label={n.totalWatch}
                value={
                  metrics.watch.totalWatchHours === null
                    ? "—"
                    : format(n.watchHours, {
                        n: Math.round(metrics.watch.totalWatchHours * 10) / 10,
                      })
                }
              />
            </li>
          </ul>
        ) : null}
        {metrics.timeline.length > 0 ? (
          <div className="flex flex-col gap-4">
            {metrics.timeline.length > 1 ? (
              <div className="max-w-xl">
                <LineChart
                  title={n.reachChart}
                  points={metrics.timeline.map((s) => ({
                    date: s.measuredAt.toISOString().slice(0, 10),
                    value: s.reach,
                  }))}
                  kind="count"
                  empty=""
                  tableLabel={n.timeline}
                  dateHeader={n.measured}
                  valueHeader={n.reach}
                  tableView={false}
                />
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{n.slot}</TableHead>
                    <TableHead>{n.age}</TableHead>
                    <TableHead>{n.measured}</TableHead>
                    <TableHead className="text-right">{n.reach}</TableHead>
                    <TableHead className="text-right">{n.views}</TableHead>
                    <TableHead className="text-right">{n.likes}</TableHead>
                    <TableHead className="text-right">{n.comments}</TableHead>
                    <TableHead className="text-right">{n.saves}</TableHead>
                    <TableHead className="text-right">{n.shares}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.timeline.map((s) => (
                    <TableRow
                      key={`${s.slot}-${s.ageHours}-${s.measuredAt.toISOString()}`}
                      data-slot={s.slot}
                    >
                      <TableCell>{s.slot}</TableCell>
                      <TableCell className="tabular-nums">
                        {format(n.hours, { n: s.ageHours })}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {when(s.measuredAt)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{count(s.reach)}</TableCell>
                      <TableCell className="text-right tabular-nums">{count(s.views)}</TableCell>
                      <TableCell className="text-right tabular-nums">{count(s.likes)}</TableCell>
                      <TableCell className="text-right tabular-nums">{count(s.comments)}</TableCell>
                      <TableCell className="text-right tabular-nums">{count(s.saves)}</TableCell>
                      <TableCell className="text-right tabular-nums">{count(s.shares)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </Section>

      {reelCard}

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{c.title}</h2>
      </div>

      <Section title={c.sources} testId="cards">
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.noCards}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cards.map((card) => (
              <li key={card.id} data-card={card.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {card.title}{" "}
                  <Badge variant="outline" className="ml-1">
                    {(c.cardRole as Record<string, string>)[card.role] ?? card.role} · v
                    {card.version}
                  </Badge>
                </p>
                <p>{card.claim}</p>
                {card.sourceTitle ? (
                  <p className="text-xs text-muted-foreground">
                    {card.sourcePage
                      ? format(c.cardMeta, { source: card.sourceTitle, page: card.sourcePage })
                      : card.sourceTitle}
                  </p>
                ) : null}
                {card.quote ? (
                  <blockquote className="mt-1 border-l-2 pl-2 text-xs text-muted-foreground">
                    {card.quote}
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={c.idea} testId="idea">
        <p className="font-medium">{idea.topic}</p>
        <p className="text-sm text-muted-foreground">
          {c.category}: {idea.category} · {c.angle}: {idea.angle}
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">{c.coreMessage}: </span>
          {idea.coreMessage}
        </p>
        {idea.evidenceSummary ? (
          <p className="text-sm">
            <span className="text-muted-foreground">{c.evidence}: </span>
            {idea.evidenceSummary}
          </p>
        ) : null}
      </Section>

      <Section title={c.adaptation} testId="brief">
        {brief ? (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              <span className="text-muted-foreground">{c.audience}: </span>
              {brief.audienceFraming}
            </p>
            <p>
              <span className="text-muted-foreground">{c.tone}: </span>
              {brief.tone}
            </p>
            {brief.risks.length > 0 ? (
              <div>
                <p className="text-muted-foreground">{c.risks}:</p>
                <ul className="list-disc pl-5">
                  {brief.risks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{c.noBrief}</p>
        )}
      </Section>

      <Section title={c.version} testId="version">
        <p className="text-sm text-muted-foreground">
          {format(c.versionLine, {
            n: version.versionNo,
            name: version.approvedBy ?? NONE,
            when: when(version.approvedAt),
          })}
        </p>
        {variant.campaignId ? (
          <p className="text-xs text-muted-foreground">
            {format(c.campaign, { id: variant.campaignId })}
          </p>
        ) : null}
        {variant.offerName ? (
          <p className="text-xs text-muted-foreground">
            {format(c.offer, { name: variant.offerName })}
          </p>
        ) : null}
        {version.slideUrls.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">
              {format(c.slides, { n: version.slideCount })}
            </p>
            <ul className="flex gap-2 overflow-x-auto pb-1">
              {version.slideUrls.map((url, i) => (
                <li key={url} className="shrink-0">
                  {/* biome-ignore lint/performance/noImgElement: presigned storage URL */}
                  <img
                    src={url}
                    alt={`${i + 1}`}
                    className="h-40 w-32 rounded border object-cover"
                    loading="lazy"
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {version.videoUrl ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">{c.video}</p>
            {/* biome-ignore lint/a11y/useMediaCaption: a silent-first Reel has no speech to caption */}
            <video
              controls
              playsInline
              preload="metadata"
              src={version.videoUrl}
              className="aspect-[9/16] w-full max-w-60 rounded-lg bg-black"
            />
          </div>
        ) : null}
        <p className="text-sm">
          <span className="text-muted-foreground">{c.caption}: </span>
          <span className="whitespace-pre-line">{version.caption}</span>
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">{c.cta}: </span>
          {version.cta.type} · {version.cta.text}
        </p>
        {version.hashtags.length > 0 ? (
          <p className="text-sm">
            <span className="text-muted-foreground">{c.hashtags}: </span>
            {version.hashtags.join(" ")}
          </p>
        ) : null}
        {version.disclosure ? (
          <p className="text-xs text-muted-foreground">
            {format(c.disclosure, { mode: version.disclosure })}
          </p>
        ) : null}
        {variant.sourceVariantId ? (
          <p className="text-sm">
            {c.sourceCarousel}{" "}
            <Link href={`/content/review/${idea.id}`} className="underline underline-offset-4">
              {c.openReel}
            </Link>
          </p>
        ) : null}
      </Section>

      <Section title={c.review} testId="review">
        {lineage.reviewHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.noReview}</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {lineage.reviewHistory.map((e) => (
              <li
                key={`${e.action}-${e.at.toISOString()}-${e.field ?? ""}`}
                data-event={e.action}
                className="flex flex-wrap gap-x-2"
              >
                <span className="w-44 shrink-0 text-muted-foreground tabular-nums">
                  {when(e.at)}
                </span>
                <span className="font-medium">
                  {(c.actions as Record<string, string>)[e.action] ?? e.action}
                </span>
                {e.field ? <span className="text-muted-foreground">{e.field}</span> : null}
                {e.reviewer ? <span className="text-muted-foreground">· {e.reviewer}</span> : null}
                {e.reasonCode ? <Badge variant="outline">{e.reasonCode}</Badge> : null}
                {e.reason ? <span className="text-muted-foreground">{e.reason}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={c.generation} testId="generation">
        {lineage.generation.runs === 0 ? (
          <p className="text-sm text-muted-foreground">{c.noGeneration}</p>
        ) : (
          <p className="text-sm">
            {format(c.generationLine, {
              runs: lineage.generation.runs,
              cost:
                lineage.generation.costUsd === null
                  ? NONE
                  : new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(
                      lineage.generation.costUsd,
                    ),
              version: variant.generationVersion ?? NONE,
            })}
          </p>
        )}
      </Section>

      {variant.reels.length > 0 ? (
        <Section title={c.relatedReel} testId="reels">
          <ul className="text-sm">
            {variant.reels.map((r) => (
              <li key={r.variantId}>
                {c.reelOf}: {r.status}{" "}
                <Link href={`/content/review/${idea.id}`} className="underline underline-offset-4">
                  {c.openReel}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
