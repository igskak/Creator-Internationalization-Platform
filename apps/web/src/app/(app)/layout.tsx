import { getWorkQueue } from "@rc/modules/content";
import { getInstagramBanners } from "@rc/modules/instagram";
import { listMarkets } from "@rc/modules/localization";
import Link from "next/link";
import type { ReactNode } from "react";
import { type Banner, Banners } from "@/components/shell/banners";
import { MobileNav } from "@/components/shell/mobile-nav";
import { buildNav } from "@/components/shell/screens";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { format, plural } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// App shell (plan 10 §10.1). Every (app) route needs an allowlisted user (12 §12.5).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const [markets, queue, instagramBanners] = await Promise.all([
    listMarkets(ctx),
    getWorkQueue(ctx),
    getInstagramBanners(ctx),
  ]);
  // What waits for a person (plan 10 §10.1): proposed ideas, cards to review, drafts to review.
  const nav = buildNav(
    markets,
    { ...messages.nav, later: messages.shell.later },
    {
      ideas: queue.ideasProposed,
      cards: queue.cardsToReview,
      drafts: queue.draftsReady + queue.changesRequested,
      calendar: queue.approvedNotScheduled,
    },
  );
  // Banners (10 §10.1): an Instagram account that needs re-auth, a token that expires within a
  // week. The kill switch banner arrives with M5-08, health findings with H-01.
  const banners: Banner[] = instagramBanners.map((b) => ({
    id: `instagram-${b.kind}-${b.marketCode}`,
    tone: b.kind === "NEEDS_REAUTH" ? "danger" : "warning",
    message:
      b.kind === "NEEDS_REAUTH"
        ? format(messages.banners.reauth, { market: b.marketName })
        : plural(locale, messages.banners.expiring, Math.max(b.daysLeft ?? 0, 0), {
            market: b.marketName,
          }),
    href: "/settings/instagram",
    linkLabel: messages.banners.open,
  }));

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r p-4 md:flex">
        <Link href="/dashboard" className="px-2 font-semibold">
          Content Engine
        </Link>
        <SidebarNav sections={nav} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between gap-2 border-b px-4">
          <div className="flex items-center gap-2">
            <MobileNav sections={nav} />
            <span className="font-semibold md:hidden">Content Engine</span>
          </div>
          <UserMenu user={{ email: user.email, displayName: user.displayName, role: user.role }} />
        </header>
        <Banners banners={banners} />
        {children}
      </div>
    </div>
  );
}
