import type { CardDetail } from "@rc/modules/knowledge";
import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { OpenPdfButton } from "./open-pdf-button";

/** The page text with the quote marked, when it was located. */
function PageText({
  text,
  range,
  lang,
}: {
  text: string;
  range: { start: number; end: number } | null;
  lang: string;
}) {
  return (
    <p lang={lang} className="whitespace-pre-wrap text-sm leading-relaxed">
      {range ? (
        <>
          {text.slice(0, range.start)}
          <mark className="rounded-sm bg-amber-200 px-0.5 text-foreground dark:bg-amber-500/40">
            {text.slice(range.start, range.end)}
          </mark>
          {text.slice(range.end)}
        </>
      ) : (
        text
      )}
    </p>
  );
}

/**
 * What the source says: the cited pages with the quote highlighted, the neighbouring pages folded
 * away, the result of the quote check, and a link to the PDF page.
 */
export function EvidencePanel({
  detail,
  locale,
  t,
}: {
  detail: CardDetail;
  locale: Locale;
  t: Messages["card"];
}) {
  const { card, source, pages } = detail;
  const ref = card.sourceReference;
  const e = t.evidence;
  const located = pages.some((p) => p.quoteRange);

  return (
    <section aria-labelledby="evidence-title" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="evidence-title" className="text-base font-medium">
          {e.title}
        </h2>
        <span className="flex-1" />
        {source?.isPdf && source.hasFile && ref?.pageStart ? (
          <OpenPdfButton sourceAssetId={source.id} page={ref.pageStart} />
        ) : null}
      </div>

      {!source || !ref ? (
        <p className="text-sm text-muted-foreground">{e.noSource}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {format(e.source, { title: source.title })}
          </p>
          <blockquote lang={card.language} className="border-l-2 pl-3 text-sm italic">
            {ref.quote}
          </blockquote>
          {ref.quoteVerified ? (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckIcon aria-hidden="true" className="size-3.5" />
              {e.quoteVerified}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {format(e.quoteUnverified, { score: formatNumber(locale, ref.matchScore ?? 0, 2) })}
            </p>
          )}
          {ref.quoteVerified && !located && pages.length > 0 ? (
            <p className="text-xs text-muted-foreground">{e.quoteNotLocated}</p>
          ) : null}
          {ref.note ? (
            <p className="text-xs text-muted-foreground">
              {format(e.checkNote, { note: ref.note })}
            </p>
          ) : null}

          {pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{e.noPages}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {pages.map((page) =>
                page.cited ? (
                  <article key={page.pageNumber} className="rounded-md bg-muted/50 p-3">
                    <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{format(e.page, { page: page.pageNumber })}</Badge>
                      <span>{e.cited}</span>
                      {page.sectionPath ? (
                        <span className="truncate">· {page.sectionPath}</span>
                      ) : null}
                    </div>
                    <PageText text={page.text} range={page.quoteRange} lang={card.language} />
                  </article>
                ) : (
                  <details key={page.pageNumber} className="rounded-md border p-3">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      {format(e.page, { page: page.pageNumber })} · {e.context}
                    </summary>
                    <div className="mt-2">
                      <PageText text={page.text} range={null} lang={card.language} />
                    </div>
                  </details>
                ),
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
