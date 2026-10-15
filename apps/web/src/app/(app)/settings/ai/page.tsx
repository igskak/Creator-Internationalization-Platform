import { listAppSettings } from "@rc/modules/settings";
import { ReelsSwitch } from "@/components/settings/reels-switch";
import { PlaceholderPage } from "@/components/shell/placeholder";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /settings/ai (plan 10 §10.2): prompt versions, models and cost by stage arrive with H-05. The
// switch of Reel generation (M8-07a) lives here already, because Reels are the part of the app
// that spends money per click.
export const dynamic = "force-dynamic";

export default async function AiPage() {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const settings = await listAppSettings(ctx);
  return (
    <PlaceholderPage screen="ai">
      <ReelsSwitch enabled={settings["reels.enabled"] === true} isOwner={user.role === "owner"} />
    </PlaceholderPage>
  );
}
