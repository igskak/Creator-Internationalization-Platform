import type { VariantView } from "@rc/modules/content";
import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { CarouselViewer } from "./carousel-viewer";
import { CriticPanel } from "./critic-panel";

type T = Messages["review"];

/** Flags that stop approval (04 §4.4 BLOCKING_VARIANT_FLAGS); the rest are warnings. */
const BLOCKING = new Set([
  "UNSUPPORTED_CLAIM",
  "NUMERIC_MISMATCH",
  "TEXT_OVERFLOW",
  "MISSING_GLYPH",
  "RENDER_FAILED",
  "VISUAL_MISSING",
  "KNOWLEDGE_ARCHIVED",
  "GENERATION_FAILED",
]);

const STATUS_STYLE: Record<string, string> = {
  READY_FOR_REVIEW: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  GENERATING: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  CHANGES_REQUESTED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  DRAFT: "bg-muted text-muted-foreground",
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-1.5">
    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
    {children}
  </section>
);

/** One market's draft as read-only text: hook, slides, caption, CTA, hashtags, critic, flags. */
export function VariantColumn({
  variant,
  cardTitles,
  t,
  locale,
}: {
  variant: VariantView;
  cardTitles: ReadonlyMap<string, string>;
  t: T;
  locale: Locale;
}) {
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  const pending =
    variant.status === "GENERATING" ||
    (variant.status === "DRAFT" && !variant.hasContent && !variant.lastError);
  const d = variant.differentiation;

  return (
    <article
      aria-label={variant.marketName}
      data-market={variant.marketCode}
      className="flex min-w-80 flex-1 flex-col gap-4 rounded-xl border p-4"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">
          {variant.flagEmoji ? <span aria-hidden="true">{variant.flagEmoji} </span> : null}
          {variant.marketName}
        </h2>
        <Badge variant="ghost" className={cn(STATUS_STYLE[variant.status])}>
          {pending && variant.status === "DRAFT" ? t.queuedStatus : t.status[variant.status]}
        </Badge>
        {variant.qualityScore !== null ? (
          <span className="text-sm text-muted-foreground tabular-nums">
            {format(t.qualityScore, { score: number.format(variant.qualityScore) })}
          </span>
        ) : null}
      </header>

      {variant.flags.length > 0 ? (
        <ul aria-label={t.flagsTitle} className="flex flex-wrap gap-1.5">
          {variant.flags.map((flag) => (
            <li key={flag}>
              <Badge variant={BLOCKING.has(flag) ? "destructive" : "secondary"}>
                {(t.flags as Record<string, string>)[flag] ?? flag}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {variant.lastError ? (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm dark:bg-red-950/40">
          <p className="font-medium">{t.failedTitle}</p>
          <p>{format(t.failedBody, { message: variant.lastError.message })}</p>
        </div>
      ) : null}

      {!variant.hasContent ? (
        pending ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {variant.status === "GENERATING" ? t.status.GENERATING : t.queuedStatus}
          </p>
        ) : null
      ) : (
        <>
          <Section title={t.viewer.label}>
            <CarouselViewer
              variantId={variant.id}
              render={variant.render}
              slideIds={variant.slides.map((s) => s.id)}
            />
          </Section>

          <Section title={t.hook}>
            <p className="text-base font-medium">{variant.hook}</p>
            {variant.hookType ? (
              <p className="text-xs text-muted-foreground">
                {t.hookType}: <span className="font-mono">{variant.hookType}</span>
              </p>
            ) : null}
          </Section>

          <Section title={`${t.slides} (${variant.slides.length})`}>
            <ol className="flex flex-col gap-2">
              {variant.slides.map((slide, i) => (
                <li key={slide.id} className="flex flex-col gap-1.5 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {format(t.slide, { n: i + 1 })}
                    </span>
                    <span>
                      {format(t.slideMeta, { role: slide.role, template: slide.templateId })}
                    </span>
                  </div>
                  <dl className="flex flex-col gap-1">
                    {Object.entries(slide.slots).map(([slot, text]) => (
                      <div key={slot}>
                        <dt className="font-mono text-[11px] text-muted-foreground">{slot}</dt>
                        <dd className="whitespace-pre-line">{text}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {slide.knowledgeIds.length > 0 ? (
                      <>
                        <span className="text-muted-foreground">{t.cites}:</span>
                        {slide.knowledgeIds.map((id) => (
                          <Badge key={id} variant="outline">
                            {cardTitles.get(id) ?? id}
                          </Badge>
                        ))}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t.notFactual}</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section title={t.caption}>
            <p className="whitespace-pre-line">{variant.caption}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {format(t.captionCount, {
                count: new Intl.NumberFormat(locale).format([...(variant.caption ?? "")].length),
              })}
            </p>
          </Section>

          <Section title={t.cta}>
            <p>
              <span className="font-mono text-xs">{variant.cta?.type}</span> · {variant.cta?.text}
              {variant.cta?.keyword ? (
                <span className="text-muted-foreground">
                  {" "}
                  ({format(t.ctaKeyword, { keyword: variant.cta.keyword })})
                </span>
              ) : null}
            </p>
            {variant.offer ? (
              <p className="text-xs text-muted-foreground">
                {t.idea.offer}: {variant.offer.name}
              </p>
            ) : null}
          </Section>

          <Section title={t.hashtags}>
            <p className="flex flex-wrap gap-1.5">
              {variant.hashtags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </p>
          </Section>

          <CriticPanel report={variant.critic} t={t} locale={locale} />

          {d ? (
            <Section title={t.idea.differentiation}>
              <p className="text-sm">
                <Badge
                  variant="ghost"
                  className={cn(
                    d.verdict === "OK" &&
                      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
                    d.verdict === "WARN" &&
                      "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                    d.verdict === "FAIL" &&
                      "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
                  )}
                >
                  {t.differentiation.verdict[d.verdict]}
                </Badge>{" "}
                <span className="text-muted-foreground tabular-nums">
                  {format(t.differentiation.hook, { value: number.format(d.hookSimilarity) })} ·{" "}
                  {format(t.differentiation.slides, {
                    value: number.format(d.slideTextSimilarity),
                  })}{" "}
                  ·{" "}
                  {format(t.differentiation.templates, {
                    value: number.format(d.templateSequenceSimilarity),
                  })}
                  {d.sameHookType ? ` · ${t.differentiation.sameHookType}` : ""}
                </span>
              </p>
              {d.reasons.length > 0 ? (
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {d.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </Section>
          ) : null}

          {variant.brief ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">{t.brief}</summary>
              <div className="mt-2 flex flex-col gap-1.5">
                <p>
                  <span className="text-muted-foreground">{t.audience}:</span>{" "}
                  {variant.brief.audienceFraming}
                </p>
                {variant.brief.risks.length > 0 ? (
                  <div>
                    <p className="text-muted-foreground">{t.risks}:</p>
                    <ul className="list-disc pl-5">
                      {variant.brief.risks.map((risk) => (
                        <li key={risk}>{risk}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          {variant.generationVersion ? (
            <p className="text-xs text-muted-foreground">
              {format(t.generationLine, { version: variant.generationVersion })}
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}
