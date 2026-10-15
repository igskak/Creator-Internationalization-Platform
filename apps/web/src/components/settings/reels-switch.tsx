"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { setAppSetting } from "@/server/actions/settings";

/**
 * The switch of Reel generation (`reels.enabled`, plan 18 §18.6, M8-07a). Off, the Generate Reel
 * button is disabled everywhere and nothing is spent on shots. Owners only; publishing has its own
 * switch in Settings → Instagram.
 */
export function ReelsSwitch({ enabled, isOwner }: { enabled: boolean; isOwner: boolean }) {
  const t = useI18n().messages.reelsSwitch;
  const router = useRouter();
  const action = useAction(setAppSetting, {
    successMessage: enabled ? t.switchedOff : t.switchedOn,
    onSuccess: () => router.refresh(),
  });

  return (
    <section aria-label={t.title} className="flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <Badge variant={enabled ? "default" : "secondary"}>{enabled ? t.on : t.off}</Badge>
      </header>
      <p className="text-sm text-muted-foreground">{t.description}</p>
      {isOwner ? (
        <div>
          <Button
            variant={enabled ? "outline" : "default"}
            disabled={action.pending}
            onClick={() => void action.run({ key: "reels.enabled", value: !enabled })}
          >
            {enabled ? t.turnOff : t.turnOn}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t.ownersOnly}</p>
      )}
    </section>
  );
}
