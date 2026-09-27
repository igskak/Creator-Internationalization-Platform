import { getMarketByCode } from "@rc/modules/localization";
import { notFound } from "next/navigation";
import { PlaceholderPage } from "@/components/shell/placeholder";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

export default async function MarketPage({ params }: { params: Promise<{ marketCode: string }> }) {
  const { marketCode } = await params;
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const market = await getMarketByCode(ctx, decodeURIComponent(marketCode));
  if (!market) notFound();
  const subject =
    `${market.flagEmoji ?? ""} ${market.displayName}${market.isActive ? "" : " (inactive)"}`.trim();
  return <PlaceholderPage screen="market" subject={subject} />;
}
