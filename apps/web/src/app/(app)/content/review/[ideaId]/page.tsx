import { NotFoundError } from "@rc/lib/errors";
import { getReviewBundle } from "@rc/modules/content";
import { listTaxonomyTerms } from "@rc/modules/settings";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/knowledge/cards-states";
import { GenerateDraftsButton } from "@/components/review/generate-drafts-button";
import { RegenerateAllDialog } from "@/components/review/regenerate-all-dialog";
import { ReviewPoller } from "@/components/review/review-poller";
import { VariantColumn } from "@/components/review/variant-column";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /content/review/[ideaId] (plan 10 §10.3, M2-15): the idea and every market's draft side by side.
// Read-only: field editing, approval and scheduling arrive with M4.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGENERABLE = new Set(["DRAFT", "READY_FOR_REVIEW", "CHANGES_REQUESTED"]);

export default async function ReviewPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  if (!UUID.test(ideaId)) notFound();
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.review;

  const [bundle, terms] = await Promise.all([
    getReviewBundle(ctx, ideaId).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listTaxonomyTerms(ctx),
  ]);
  const { idea: detail, variants, costUsd } = bundle;
  const { idea, product, cards } = detail;
  const label = (kind: string, code: string) =>
    terms.find((term) => term.kind === kind && term.code === code)?.label ?? code;
  const reasons = terms
    .filter((term) => term.kind === "reason_code" && term.isActive)
    .map(({ code, label: text }) => ({ code, label: text }));
  const cardTitles = new Map(cards.map((card) => [card.id, card.title]));
  const money = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const worst = variants
    .map((v) => v.differentiation)
    .filter((d) => d !== null)
    .sort(
      (a, b) =>
        ["OK", "WARN", "FAIL"].indexOf(b.verdict) - ["OK", "WARN", "FAIL"].indexOf(a.verdict),
    )[0];
  const canRegenerate =
    variants.length > 0 && variants.every((v) => REGENERABLE.has(v.status)) && reasons.length > 0;
  const generationVersion = variants.find((v) => v.generationVersion)?.generationVersion;

  return (
    <main className="flex flex-col gap-4 p-6">
      <Link
        href={`/content/ideas/${idea.id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {t.back}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{idea.topic}</h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{idea.status}</Badge>
            <span className="text-muted-foreground">
              {label("category", idea.category)} · {label("angle", idea.angle)}
            </span>
            {product ? <Badge variant="secondary">{product.name}</Badge> : null}
          </div>
        </div>
        {variants.length > 0 ? (
          <RegenerateAllDialog ideaId={idea.id} reasons={reasons} disabled={!canRegenerate} />
        ) : null}
      </header>

      <ReviewPoller
        variants={variants.map((v) => ({
          id: v.id,
          status: v.status,
          inProgress:
            v.status === "GENERATING" || (v.status === "DRAFT" && !v.hasContent && !v.lastError),
        }))}
      />

      {variants.length === 0 ? (
        idea.status === "ACCEPTED" ? (
          <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
            <h2 className="text-lg font-medium">{t.emptyTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.emptyBody}</p>
            <GenerateDraftsButton ideaId={idea.id} />
          </section>
        ) : (
          <EmptyState
            title={t.emptyTitle}
            body={format(t.notAccepted, { status: idea.status })}
            action={{ href: `/content/ideas/${idea.id}`, label: t.idea.openIdea }}
          />
        )
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <aside
            aria-label={t.idea.title}
            className="flex w-full flex-col gap-4 rounded-xl border bg-muted/30 p-4 xl:sticky xl:top-4 xl:w-80 xl:shrink-0"
          >
            <section className="flex flex-col gap-1">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t.idea.coreMessage}
              </h2>
              <p lang="en">{idea.coreMessage}</p>
            </section>
            {idea.evidenceSummary ? (
              <section className="flex flex-col gap-1">
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t.idea.evidence}
                </h2>
                <p className="text-sm">{idea.evidenceSummary}</p>
              </section>
            ) : null}
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t.idea.cards}
              </h2>
              <ul className="flex flex-col gap-2">
                {cards.map((card) => (
                  <li key={card.id} className="rounded-lg border bg-background p-2 text-sm">
                    <p className="font-medium">
                      {card.title}{" "}
                      <span className="font-normal text-muted-foreground">
                        {format(t.idea.version, { version: card.version })}
                      </span>
                    </p>
                    <p lang={card.language}>{card.claim}</p>
                    {card.sourceTitle ? (
                      <p className="text-xs text-muted-foreground">
                        {format(t.idea.source, { title: card.sourceTitle })}
                        {card.page ? `, ${format(t.idea.page, { page: card.page })}` : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
            <section className="flex flex-col gap-1 text-sm">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t.idea.offer}
              </h2>
              <p>{product ? product.name : t.idea.noOffer}</p>
            </section>
            {worst ? (
              <section className="flex flex-col gap-1 text-sm">
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t.idea.differentiation}
                </h2>
                <p>{t.differentiation.verdict[worst.verdict]}</p>
                <p className="text-xs text-muted-foreground">
                  {format(t.differentiation.thresholds, { version: worst.thresholdsVersion })}
                </p>
              </section>
            ) : null}
            <section className="flex flex-col gap-1 text-xs text-muted-foreground">
              <h2 className="font-medium tracking-wide uppercase">{t.idea.generation}</h2>
              {generationVersion ? (
                <p>{format(t.generationLine, { version: generationVersion })}</p>
              ) : null}
              <p>
                {costUsd === null
                  ? t.idea.noCost
                  : format(t.idea.cost, { cost: money.format(costUsd) })}
              </p>
            </section>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-auto lg:flex-row">
            {variants.map((variant) => (
              <VariantColumn
                key={variant.id}
                variant={variant}
                cardTitles={cardTitles}
                t={t}
                locale={locale}
              />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
