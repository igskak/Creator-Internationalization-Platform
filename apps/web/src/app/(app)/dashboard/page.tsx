import { getWorkQueue, type WorkQueue } from "@rc/modules/content";
import { getSystemHealth } from "@rc/modules/health";
import Link from "next/link";
import { HealthTiles, StateBadge } from "@/components/health/health-view";
import { draftsHref } from "@/lib/drafts-query";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /dashboard (plan 10 §10.2, M4-07, H-01): the work queue, one counter per thing that waits for a
// person, each linking to where it is worked off; then the system health tiles, each opening its
// section of /settings/health (recent activity is there too).
export const dynamic = "force-dynamic";

const LINKS: Record<keyof WorkQueue, string> = {
  cardsToReview: "/knowledge/cards",
  ideasProposed: "/content/ideas",
  draftsReady: "/content/drafts",
  changesRequested: "/content/drafts",
  approvedNotScheduled: "/content/calendar",
  scheduledNext7Days: "/content/calendar",
  failed: draftsHref({ tab: "FAILED", market: undefined, flagged: false, page: 1 }),
};
const ORDER = [
  "cardsToReview",
  "ideasProposed",
  "draftsReady",
  "changesRequested",
  "approvedNotScheduled",
  "scheduledNext7Days",
  "failed",
] as const satisfies readonly (keyof WorkQueue)[];

export default async function DashboardPage() {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.dashboard;
  const th = messages.systemHealth;
  const queue = await getWorkQueue(ctx);
  const health = await getSystemHealth(ctx);
  const waiting = ORDER.some((key) => key !== "scheduledNext7Days" && queue[key] > 0);

  return (
    <main className="flex max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground">{waiting ? t.subtitle : t.nothingWaiting}</p>
      </div>

      <section aria-label={t.queue} className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {t.queue}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ORDER.map((key) => (
            <li key={key}>
              <Link
                href={LINKS[key]}
                data-counter={key}
                className={cn(
                  "flex h-full flex-col gap-1 rounded-xl border p-4 transition-colors hover:bg-muted",
                  key === "failed" && queue.failed > 0 && "border-destructive/40",
                )}
              >
                <span className="text-3xl font-semibold tabular-nums">{queue[key]}</span>
                <span className="text-sm text-muted-foreground">{t.counters[key]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t.health} className="flex flex-col gap-3">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {t.health}
          <StateBadge state={health.overall} t={th} />
          <Link href="/settings/health" className="normal-case tracking-normal underline">
            {th.details}
          </Link>
        </h2>
        <HealthTiles health={health} t={th} locale={locale} />
      </section>
    </main>
  );
}
