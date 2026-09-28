import { getMarketProfile } from "@rc/modules/localization";
import { listTaxonomyTerms } from "@rc/modules/settings";
import { notFound } from "next/navigation";
import { MarketForm } from "@/components/settings/market-form";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /markets/[code] (10 §10.2, M0-18). Owners and editors edit the profile; only owners activate.
export default async function MarketPage({ params }: { params: Promise<{ marketCode: string }> }) {
  const { marketCode } = await params;
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const [market, terms] = await Promise.all([
    getMarketProfile(ctx, decodeURIComponent(marketCode)),
    listTaxonomyTerms(ctx),
  ]);
  if (!market) notFound();
  const visualStyles = terms
    .filter((t) => t.kind === "visual_style" && t.isActive)
    .map((t) => t.code);

  return (
    <main className="flex max-w-5xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {market.flagEmoji} {market.displayName}
          {!market.isActive && <span className="text-muted-foreground"> · inactive</span>}
        </h1>
        <p className="text-muted-foreground">
          Market profile used to adapt and write content for this market.
        </p>
      </div>
      <MarketForm
        market={{
          id: market.id,
          code: market.code,
          displayName: market.displayName,
          timezone: market.timezone,
          measurementSystem: market.measurementSystem,
          isActive: market.isActive,
          toneNotes: market.toneNotes,
          foodCultureNotes: market.foodCultureNotes,
          preferredVocabulary: market.preferredVocabulary,
          forbiddenPatterns: market.forbiddenPatterns,
          visualHypotheses: market.visualHypotheses,
        }}
        visualStyles={visualStyles}
        canEdit={user.role === "owner" || user.role === "editor"}
        canActivate={user.role === "owner"}
      />
    </main>
  );
}
