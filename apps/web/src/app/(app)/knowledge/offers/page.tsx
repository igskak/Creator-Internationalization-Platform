import { getProductsOverview } from "@rc/modules/offers";
import { EmptyState } from "@/components/knowledge/cards-states";
import { OffersBoard } from "@/components/offers/offers-board";
import { ProductDialog } from "@/components/offers/product-dialog";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /knowledge/offers (plan 10 §10.2, M2-02): products and their offers per market.
export const dynamic = "force-dynamic";

export default async function OffersPage() {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { messages } = await getI18n();
  const t = messages.offers;
  const overview = await getProductsOverview(ctx);
  const canEdit = user.role === "owner" || user.role === "editor";

  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>
        {canEdit ? <ProductDialog materials={overview.materials} /> : null}
      </div>
      {overview.products.length === 0 ? (
        <EmptyState title={t.empty.title} body={t.empty.body} />
      ) : (
        <OffersBoard overview={overview} canEdit={canEdit} />
      )}
      {canEdit ? null : <p className="text-sm text-muted-foreground">{t.readOnly}</p>}
    </main>
  );
}
