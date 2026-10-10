import type { VariantView } from "@rc/modules/content";
import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { CarouselViewer } from "./carousel-viewer";
import { ConflictBanner } from "./conflict-banner";
import { CriticPanel } from "./critic-panel";
import { EditableCta } from "./editable-cta";
import { EditableHashtags } from "./editable-hashtags";
import { EditableText } from "./editable-text";
import { SlideCard } from "./slide-card";
import { SlideDrawer } from "./slide-drawer";
import { type ConfirmKind, type TemplateInfo, VariantProvider } from "./variant-state";

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
const CONFIRM_KIND: Partial<Record<string, ConfirmKind>> = {
  APPROVED: "approved",
  SCHEDULED: "scheduled",
  FAILED: "failed",
};

export function VariantColumn({
  variant,
  cardTitles,
  t,
  locale,
  reasons,
  templates,
  ctaTypes,
}: {
  variant: VariantView;
  cardTitles: ReadonlyMap<string, string>;
  t: T;
  locale: Locale;
  reasons: { code: string; label: string }[];
  templates: TemplateInfo;
  ctaTypes: { code: string; label: string }[];
}) {
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  const pending =
    variant.status === "GENERATING" ||
    (variant.status === "DRAFT" && !variant.hasContent && !variant.lastError);
  const d = variant.differentiation;
  const cardRecord = Object.fromEntries(cardTitles);
  const edit = variant.allowed.find((a) => a.action === "edit");
  const editBlocker = !edit ? t.edit.noEdit : (edit.blockers[0]?.message ?? null);
  const confirmKind = edit?.confirm ? (CONFIRM_KIND[variant.status] ?? null) : null;

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
        <VariantProvider
          variantId={variant.id}
          lockVersion={variant.lockVersion}
          editBlocker={editBlocker}
          confirmKind={confirmKind}
          reasons={reasons}
          templates={templates}
          regenerations={variant.regenerations.map((r) => ({
            reviewEventId: r.reviewEventId,
            field: r.field,
            original: r.original,
            edited: r.edited,
          }))}
        >
          <ConflictBanner />

          <Section title={t.viewer.label}>
            <CarouselViewer
              variantId={variant.id}
              render={variant.render}
              slideIds={variant.slides.map((s) => s.id)}
            />
          </Section>

          <Section title={t.hook}>
            <EditableText
              path="hook"
              label={t.hook}
              fieldLabel={t.edit.field.hook}
              value={variant.hook ?? ""}
              textClassName="text-base font-medium"
            />
            {variant.hookType ? (
              <p className="text-xs text-muted-foreground">
                {t.hookType}: <span className="font-mono">{variant.hookType}</span>
              </p>
            ) : null}
          </Section>

          <Section title={`${t.slides} (${variant.slides.length})`}>
            <ol className="flex flex-col gap-2">
              {variant.slides.map((slide, i) => (
                <SlideCard key={slide.id} slide={slide} index={i} cardTitles={cardRecord} />
              ))}
            </ol>
            <SlideDrawer slides={variant.slides} cardTitles={cardRecord} />
          </Section>

          <Section title={t.caption}>
            <EditableText
              path="caption"
              label={t.caption}
              fieldLabel={t.edit.field.caption}
              value={variant.caption ?? ""}
              maxChars={2200}
              rows={6}
            />
          </Section>

          <Section title={t.cta}>
            <EditableCta
              cta={variant.cta}
              ctaTypes={ctaTypes}
              offerName={variant.offer?.name ?? null}
            />
          </Section>

          <Section title={t.hashtags}>
            <EditableHashtags value={variant.hashtags} />
          </Section>

          <CriticPanel report={variant.critic} t={t} locale={locale} />
        </VariantProvider>
      )}
      {variant.hasContent ? (
        <>
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
      ) : null}
    </article>
  );
}
