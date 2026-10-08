import { NotFoundError } from "@rc/lib/errors";
import { getIdeaDetail, listActiveProducts } from "@rc/modules/content";
import { listTaxonomyTerms } from "@rc/modules/settings";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { IdeaForm } from "@/components/ideas/idea-form";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /content/ideas/[id]/edit (plan 05 §5.6 updateIdea, M2-08): the same form as a new idea. Only a
// PROPOSED or ACCEPTED idea without drafts past the first stage can be edited.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditIdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { messages } = await getI18n();
  const t = messages.ideas.form;

  const [detail, terms, products] = await Promise.all([
    getIdeaDetail(ctx, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listTaxonomyTerms(ctx),
    listActiveProducts(ctx),
  ]);
  if (!detail.canEdit) redirect(`/content/ideas/${id}`);
  const active = terms.filter((term) => term.isActive);
  const { idea } = detail;

  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6">
      <Link
        href={`/content/ideas/${id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {t.backToIdea}
      </Link>
      <h1 className="text-2xl font-semibold">{t.editTitle}</h1>
      <IdeaForm
        mode="edit"
        categories={active
          .filter((term) => term.kind === "category")
          .map(({ code, label }) => ({ code, label }))}
        angles={active
          .filter((term) => term.kind === "angle")
          .map(({ code, label }) => ({ code, label }))}
        products={products.map(({ id, name }) => ({ id, name }))}
        initial={{
          id: idea.id,
          topic: idea.topic,
          category: idea.category,
          angle: idea.angle,
          coreMessage: idea.coreMessage,
          intent: idea.commercialIntent,
          productId: idea.productId,
          cards: detail.cards.map((card) => ({ id: card.id, role: card.role, title: card.title })),
        }}
      />
    </main>
  );
}
