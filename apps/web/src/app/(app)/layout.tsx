import { listMarkets } from "@rc/modules/localization";
import Link from "next/link";
import type { ReactNode } from "react";
import { type Banner, Banners } from "@/components/shell/banners";
import { MobileNav } from "@/components/shell/mobile-nav";
import { buildNav } from "@/components/shell/screens";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// App shell (plan 10 §10.1). Every (app) route needs an allowlisted user (12 §12.5).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const nav = buildNav(await listMarkets(ctx));
  // Banner sources (kill switch, Instagram re-auth, token expiry) arrive with M4/M5 and H-01.
  const banners: Banner[] = [];

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r p-4 md:flex">
        <Link href="/dashboard" className="px-2 font-semibold">
          RegChef Content Engine
        </Link>
        <SidebarNav sections={nav} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between gap-2 border-b px-4">
          <div className="flex items-center gap-2">
            <MobileNav sections={nav} />
            <span className="font-semibold md:hidden">RegChef</span>
          </div>
          <UserMenu user={{ email: user.email, displayName: user.displayName, role: user.role }} />
        </header>
        <Banners banners={banners} />
        {children}
      </div>
    </div>
  );
}
