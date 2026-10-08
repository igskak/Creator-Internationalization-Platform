import { listActiveProducts } from "@rc/modules/content";
import { listTaxonomyTerms } from "@rc/modules/settings";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { IdeaForm } from "@/components/ideas/idea-form";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /content/ideas/new (plan 10 §10.2, M2-08): a manual idea with a picker of approved cards.
export const dynamic = "force-dynamic";

export default async function NewIdeaPage() {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { messages } = await getI18n();
  const t = messages.ideas.form;
  const [terms, products] = await Promise.all([listTaxonomyTerms(ctx), listActiveProducts(ctx)]);
  const active = terms.filter((term) => term.isActive);

  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6">
      <Link
        href="/content/ideas"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {t.back}
      </Link>
      <h1 className="text-2xl font-semibold">{t.newTitle}</h1>
      <IdeaForm
        mode="create"
        categories={active
          .filter((term) => term.kind === "category")
          .map(({ code, label }) => ({ code, label }))}
        angles={active
          .filter((term) => term.kind === "angle")
          .map(({ code, label }) => ({ code, label }))}
        products={products.map(({ id, name }) => ({ id, name }))}
      />
    </main>
  );
}
