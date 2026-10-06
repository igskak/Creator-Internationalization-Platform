import { NotFoundError } from "@rc/lib/errors";
import { getSourceDetail } from "@rc/modules/knowledge";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SourceActions } from "@/components/knowledge/source-actions";
import { SourceStatus } from "@/components/knowledge/source-status";
import { SourcesPoller } from "@/components/knowledge/sources-poller";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /knowledge/sources/[id] (plan 10 §10.2, M1-04): metadata, rights, pages preview, batches, errors
// and the actions on one source.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.sources;
  const d = t.detail;
  const detail = await getSourceDetail(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { source } = detail;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const size = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const rightsOf = source.rights;
  const { EXTRACTED, NEEDS_REVIEW, CHEF_APPROVED, ARCHIVED } = detail.cardsByStatus;

  return (
    <main className="flex max-w-5xl flex-col gap-5 p-6">
      <SourcesPoller sources={[{ id, status: source.status, percent: source.percent }]} />
      <Link
        href="/knowledge/sources"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {t.back}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 lang={source.language} className="text-2xl font-semibold">
            {source.title}
          </h1>
          <SourceStatus status={source.status} percent={source.percent} t={t} />
        </div>
        <SourceActions
          id={id}
          status={source.status}
          hasFile={detail.hasFile}
          rights={{
            use: rightsOf.use,
            translate: rightsOf.translate,
            adapt: rightsOf.adapt,
            visuallyTransform: rightsOf.visuallyTransform,
            sell: rightsOf.sell,
            aiProcessing: rightsOf.aiProcessing,
            improvePrompts: rightsOf.improvePrompts,
          }}
          rightsStatus={source.rightsStatus}
          role={user.role}
        />
      </div>

      {source.error ? (
        <section role="alert" className="rounded-lg border border-destructive/40 p-4">
          <h2 className="text-sm font-medium text-destructive">{d.error}</h2>
          <p className="text-sm">{source.error.message}</p>
          <p className="font-mono text-xs text-muted-foreground">{source.error.code}</p>
        </section>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="text-base font-medium">{d.metadata}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{d.type}</dt>
            <dd>{t.types[source.type]}</dd>
            <dt className="text-muted-foreground">{d.language}</dt>
            <dd>{source.language}</dd>
            {source.author ? (
              <>
                <dt className="text-muted-foreground">{d.author}</dt>
                <dd>{source.author}</dd>
              </>
            ) : null}
            {source.fileName ? (
              <>
                <dt className="text-muted-foreground">{d.file}</dt>
                <dd>
                  {source.fileName}
                  {source.sizeBytes ? ` · ${size.format(source.sizeBytes / (1024 * 1024))} MB` : ""}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{d.added}</dt>
            <dd>{date.format(source.createdAt)}</dd>
            <dt className="text-muted-foreground">{d.progress}</dt>
            <dd>{format(d.attempt, { attempt: source.attempt })}</dd>
          </dl>
        </section>

        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-medium">{d.rights}</h2>
            <Badge variant="outline">{t.rightsStatus[source.rightsStatus]}</Badge>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {(
              [
                "use",
                "translate",
                "adapt",
                "visuallyTransform",
                "sell",
                "aiProcessing",
                "improvePrompts",
              ] as const
            ).map((key) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{t.rights[key]}</dt>
                <dd>{t.permission[rightsOf[key]]}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            {rightsOf.confirmedAt ? d.confirmed : d.notConfirmed}
          </p>
        </section>
      </div>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium">{d.cards}</h2>
          {source.cards > 0 ? (
            <Link
              href={`/knowledge/cards?source=${id}&status=all`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {d.openCards}
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {format(d.cardsSummary, {
            review: NEEDS_REVIEW + EXTRACTED,
            approved: CHEF_APPROVED,
            archived: ARCHIVED,
            unverified: detail.unverifiedQuotes,
          })}
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="text-base font-medium">{d.batches}</h2>
        {detail.batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.noBatches}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {detail.batches.map((b) => (
              <li key={b.batchIndex} className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">
                  {format(d.batchRange, { start: b.pageStart, end: b.pageEnd })}
                </span>
                <span className="text-xs text-muted-foreground">{d.batchMode[b.mode]}</span>
                <Badge variant={b.status === "FAILED" ? "destructive" : "outline"}>
                  {(d.batchStatus as Record<string, string>)[b.status] ?? b.status}
                </Badge>
                <span className="text-xs text-muted-foreground">{b.cardsCreated}</span>
                {b.error ? (
                  <span className="text-xs text-destructive">{b.error.message}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="text-base font-medium">{d.pages}</h2>
        {detail.pages.total > 0 ? (
          <p className="text-sm text-muted-foreground">
            {format(d.pagesSummary, {
              total: detail.pages.total,
              without: detail.pages.withoutText,
              transcribed: detail.pages.transcribed,
            })}
          </p>
        ) : null}
        {detail.preview.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.noPreview}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-medium text-muted-foreground">{d.preview}</h3>
            {detail.preview.map((p) => (
              <div key={p.pageNumber} lang={source.language} className="text-sm">
                <p className="text-xs text-muted-foreground">
                  {format(t.detail.batchRange, { start: p.pageNumber, end: p.pageNumber })}
                </p>
                <p className="whitespace-pre-line">
                  {p.text}
                  {p.truncated ? d.truncated : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
