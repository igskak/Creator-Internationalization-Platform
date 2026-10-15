import { getAiCostOverview } from "@rc/modules/ai";
import { listAppSettings } from "@rc/modules/settings";
import { AiOverview } from "@/components/settings/ai-overview";
import { ReelsSwitch } from "@/components/settings/reels-switch";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /settings/ai (plan 10 §10.2, H-05): the monthly budget and its state, the cost of this month by
// stage, and the prompt version, model and effort of every stage (read-only: set in code). The
// switch of Reel generation (M8-07a) lives here too, because Reels spend money per click.
export const dynamic = "force-dynamic";

export default async function AiPage() {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.aiSettings;
  const [settings, overview] = await Promise.all([listAppSettings(ctx), getAiCostOverview(ctx)]);
  return (
    <main className="flex max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground">{t.subtitle}</p>
      </div>
      <AiOverview overview={overview} isOwner={user.role === "owner"} t={t} locale={locale} />
      <ReelsSwitch enabled={settings["reels.enabled"] === true} isOwner={user.role === "owner"} />
    </main>
  );
}
