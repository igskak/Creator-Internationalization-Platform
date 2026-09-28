import { getBrand, listTaxonomyTerms } from "@rc/modules/settings";
import { BrandForm } from "@/components/settings/brand-form";
import { TaxonomyEditor } from "@/components/settings/taxonomy-editor";
import { VisualSystemForm } from "@/components/settings/visual-system-form";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /settings/brand (10 §10.2, M0-18). Owners edit; other roles see a read-only view.
export default async function BrandSettingsPage() {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const [brand, terms] = await Promise.all([getBrand(ctx), listTaxonomyTerms(ctx)]);
  const canEdit = user.role === "owner";

  return (
    <main className="flex max-w-5xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Brand</h1>
        <p className="text-muted-foreground">
          {canEdit
            ? "Voice guide, visual system and taxonomy."
            : "Read-only: only owners can change brand settings."}
        </p>
      </div>
      <BrandForm
        brand={{
          id: brand.id,
          name: brand.name,
          description: brand.description,
          brandVoice: brand.brandVoice,
        }}
        canEdit={canEdit}
      />
      <VisualSystemForm brandId={brand.id} visualSystem={brand.visualSystem} canEdit={canEdit} />
      <TaxonomyEditor
        terms={terms.map((t) => ({
          kind: t.kind,
          code: t.code,
          label: t.label,
          isActive: t.isActive,
        }))}
        canEdit={canEdit}
      />
    </main>
  );
}
