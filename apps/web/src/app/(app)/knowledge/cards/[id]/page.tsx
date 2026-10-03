import { NotFoundError } from "@rc/lib/errors";
import { getCardWithEvidence } from "@rc/modules/knowledge";
import { listTaxonomyTerms } from "@rc/modules/settings";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UsedByIdeas, VersionHistory } from "@/components/knowledge/card-side-panels";
import { CardWorkspace } from "@/components/knowledge/card-workspace";
import { EvidencePanel } from "@/components/knowledge/evidence-panel";
import { FlagBadges } from "@/components/knowledge/flag-badges";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /knowledge/cards/[id] (plan 10 §10.2, M1-18): edit one card, see what the source says, approve,
// archive or restore it, and see its versions.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.card;

  const [detail, terms] = await Promise.all([
    getCardWithEvidence(ctx, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listTaxonomyTerms(ctx),
  ]);
  const { card } = detail;
  const categories = terms
    .filter((term) => term.kind === "category" && term.isActive)
    .map((term) => ({ code: term.code, label: term.label }));
  const archiveReasons = messages.cards.archiveDialog.reasons as Record<string, string>;

  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6">
      <Link
        href="/knowledge/cards"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {t.back}
      </Link>

      <div className="flex flex-col gap-2">
        <h1 lang={card.language} className="text-2xl font-semibold">
          {card.title || t.untitled}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <FlagBadges flags={card.flags} />
          {card.status === "ARCHIVED" && card.archiveReason ? (
            <span className="text-sm text-muted-foreground">
              {format(t.archivedBecause, {
                reason: archiveReasons[card.archiveReason] ?? card.archiveReason,
              })}
            </span>
          ) : null}
        </div>
        {detail.duplicateOf ? (
          <p className="text-sm">
            {t.duplicateOf}{" "}
            <Link
              className="underline underline-offset-4"
              href={`/knowledge/cards/${detail.duplicateOf.id}`}
            >
              {detail.duplicateOf.title}
            </Link>
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Remounted with the new data after every save, approval or archive. */}
        <CardWorkspace
          key={`${card.version}:${card.status}:${card.updatedAt.getTime()}`}
          card={{
            id: card.id,
            title: card.title,
            category: card.category,
            subcategory: card.subcategory,
            claim: card.claim,
            explanation: card.explanation,
            procedureJson: card.procedureJson,
            ingredientsJson: card.ingredientsJson,
            temperaturesJson: card.temperaturesJson,
            timingsJson: card.timingsJson,
            commonMistakesJson: card.commonMistakesJson,
            safetySensitive: card.safetySensitive,
            safetyNotes: card.safetyNotes,
            tags: card.tags,
            version: card.version,
            approvedVersion: card.approvedVersion,
            status: card.status,
            flags: card.flags,
            language: card.language,
            archiveReason: card.archiveReason,
            quoteVerified: card.sourceReference ? card.sourceReference.quoteVerified : null,
          }}
          categories={categories}
          canApprove={user.role === "chef" || user.role === "owner"}
        />
        <aside className="flex min-w-0 flex-col gap-4">
          <EvidencePanel detail={detail} locale={locale} t={t} />
          <VersionHistory versions={detail.versions} locale={locale} t={t} />
          <UsedByIdeas ideas={detail.usedByIdeas} t={t} />
        </aside>
      </div>
    </main>
  );
}
