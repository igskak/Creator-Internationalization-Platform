import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/server/auth/session";

// Every (app) route needs an allowlisted user (plan 12 §12.5). The full shell arrives in M0-17.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">RegChef Content Engine</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {user.email} · {user.role}
          </span>
          <form action="/auth/sign-out" method="post">
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
