import { NotFoundError } from "@rc/lib/errors";
import { getIdeaDetail } from "@rc/modules/content";
import { listTaxonomyTerms } from "@rc/modules/settings";
import { ArrowLeftIcon, PencilIcon, ShieldAlertIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IdeaActions } from "@/components/ideas/idea-actions";
import { IdeaStatusBadge } from "@/components/ideas/idea-status";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /content/ideas/[id] (plan 10 §10.2, M2-08): one idea with the approved text of the cards it was
// built from, what is still open for it, and the actions of its status.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.ideas;
  const d = t.detail;

  const [detail, terms] = await Promise.all([
    getIdeaDetail(ctx, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listTaxonomyTerms(ctx),
  ]);
  const { idea, product, cards, variants } = detail;
  const label = (kind: string, code: string) =>
    terms.find((term) => term.kind === kind && term.code === code)?.label ?? code;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const cardsApproved = cards.every((card) => card.currentStatus === "CHEF_APPROVED");
  const cardStatus = messages.cards.tabs as Record<string, string>;

  return (
    <main className="flex max-w-5xl flex-col gap-5 p-6">
      <Link
        href="/content/ideas"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {d.back}
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{idea.topic}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <IdeaStatusBadge status={idea.status} label={t.tabs[idea.status]} />
          <Badge variant="outline">{t.origin[idea.origin]}</Badge>
          {idea.commercialIntent !== "NONE" ? (
            <Badge variant="secondary">
              {t.intent[idea.commercialIntent]}
              {product ? ` · ${product.name}` : ""}
            </Badge>
          ) : null}
        </div>
        {idea.status === "REJECTED" && idea.rejectedReason ? (
          <p className="text-sm text-muted-foreground">
            {format(d.rejectedReason, { reason: idea.rejectedReason })}
          </p>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <IdeaActions ideaId={idea.id} status={idea.status} cardsApproved={cardsApproved} />
        {detail.canEdit ? (
          <Link
            href={`/content/ideas/${idea.id}/edit`}
            className={buttonVariants({ variant: "outline" })}
          >
            <PencilIcon /> {d.edit}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">{d.noEdit}</span>
        )}
      </div>

      <section
        className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-4"
        aria-labelledby="core-message"
      >
        <h2 id="core-message" className="text-sm font-medium text-muted-foreground">
          {d.coreMessage}
        </h2>
        <p lang="en" className="text-lg">
          {idea.coreMessage}
        </p>
      </section>

      <dl className="grid gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{d.category}</dt>
          <dd>{label("category", idea.category)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{d.angle}</dt>
          <dd>{label("angle", idea.angle)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{d.offer}</dt>
          <dd>{product ? product.name : t.intent.NONE}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{d.created}</dt>
          <dd className="tabular-nums">{date.format(idea.createdAt)}</dd>
        </div>
      </dl>

      {idea.evidenceSummary || idea.rationale ? (
        <section className="flex flex-col gap-3" aria-label={d.whyNow}>
          {idea.evidenceSummary ? (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">{d.evidence}</h2>
              <p className="whitespace-pre-line">{idea.evidenceSummary}</p>
            </div>
          ) : null}
          {idea.rationale ? (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">{d.whyNow}</h2>
              <p className="whitespace-pre-line">{idea.rationale}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="idea-cards">
        <div>
          <h2 id="idea-cards" className="text-lg font-medium">
            {d.cardsTitle}
          </h2>
          <p className="text-sm text-muted-foreground">{d.cardsHint}</p>
        </div>
        <ul className="flex flex-col gap-3">
          {cards.map((card) => (
            <li key={card.id} className="flex flex-col gap-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={card.role === "PRIMARY" ? "default" : "secondary"}>
                  {messages.ideas.form.role[card.role]}
                </Badge>
                <h3 lang={card.language} className="font-medium">
                  {card.title}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {format(d.version, { version: card.version })}
                </span>
                {card.safetySensitive ? (
                  <Badge variant="ghost" className="bg-destructive/10 text-destructive">
                    <ShieldAlertIcon aria-hidden="true" /> {d.safety}
                  </Badge>
                ) : null}
                {card.currentStatus !== "CHEF_APPROVED" ? (
                  <Badge
                    variant="ghost"
                    className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                  >
                    {format(d.noLongerApproved, {
                      status: cardStatus[card.currentStatus] ?? card.currentStatus,
                    })}
                  </Badge>
                ) : card.currentApprovedVersion !== null &&
                  card.currentApprovedVersion > card.version ? (
                  <Badge
                    variant="ghost"
                    className="bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
                  >
                    {format(d.newerVersion, { version: card.currentApprovedVersion })}
                  </Badge>
                ) : null}
              </div>
              <p lang={card.language}>{card.claim}</p>
              {card.explanation ? (
                <p lang={card.language} className="text-sm text-muted-foreground">
                  {card.explanation}
                </p>
              ) : null}
              {card.quote ? (
                <blockquote
                  lang={card.language}
                  className="border-l-2 pl-3 text-sm text-muted-foreground"
                >
                  {card.quote}
                </blockquote>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {card.sourceTitle && card.sourceId ? (
                  <Link
                    href={`/knowledge/sources/${card.sourceId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {format(d.source, { title: card.sourceTitle })}
                    {card.page ? ` · ${format(d.page, { page: card.page })}` : ""}
                  </Link>
                ) : null}
                <Link
                  href={`/knowledge/cards/${card.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {d.openCard}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="idea-variants">
        <h2 id="idea-variants" className="text-lg font-medium">
          {d.variantsTitle}
        </h2>
        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.noVariants}</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2">
              {variants.map((variant) => (
                <li key={variant.id}>
                  <Badge variant="outline">
                    {variant.marketCode} · {variant.status}
                  </Badge>
                </li>
              ))}
            </ul>
            <Link
              href={`/content/review/${idea.id}`}
              className="w-fit text-sm underline-offset-4 hover:underline"
            >
              {d.openReview}
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
