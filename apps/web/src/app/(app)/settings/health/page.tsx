import { getSystemHealth } from "@rc/modules/health";
import { HealthReport } from "@/components/health/health-view";
import { PublishingSwitch } from "@/components/instagram/publishing-switch";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /settings/health (plan 10 §10.2, 12 §12.9, H-01): every health indicator with its rule and
// details, the stuck items with links, the open integration findings, the newest audit events,
// and the owner's kill switch.
export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.systemHealth;
  const health = await getSystemHealth(ctx);
  return (
    <main className="flex max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground">{t.subtitle}</p>
      </div>
      <HealthReport
        health={health}
        t={t}
        locale={locale}
        killSwitch={
          <PublishingSwitch
            enabled={health.publishing.enabled}
            mode={health.publishing.mode}
            allowlist={ctx.instagram.app?.accountAllowlist ?? []}
            isOwner={user.role === "owner"}
          />
        }
      />
    </main>
  );
}
