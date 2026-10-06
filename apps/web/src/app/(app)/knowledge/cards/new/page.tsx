import { listTaxonomyTerms } from "@rc/modules/settings";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { NewCardForm } from "@/components/knowledge/new-card-form";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /knowledge/cards/new (plan 10 §10.2, M1-20): a card written by hand; it goes to review.
export const dynamic = "force-dynamic";

export default async function NewCardPage() {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.newCard;
  const terms = await listTaxonomyTerms(ctx);
  const categories = terms
    .filter((term) => term.kind === "category" && term.isActive)
    .map((term) => ({ code: term.code, label: term.label }));

  return (
    <main className="flex flex-col gap-4 p-6">
      <Link
        href="/knowledge/cards"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {t.back}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground">{t.subtitle}</p>
      </div>
      <NewCardForm categories={categories} defaultLanguage={locale === "ru" ? "ru" : "en"} />
    </main>
  );
}
