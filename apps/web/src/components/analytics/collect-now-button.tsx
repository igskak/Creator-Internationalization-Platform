"use client";

import { RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { collectMetricsNow } from "@/server/actions/analytics";

/** "Collect numbers now": a manual snapshot of one post (J11 with the MANUAL slot). */
export function CollectNowButton({
  publicationId,
  canManage,
}: {
  publicationId: string;
  canManage: boolean;
}) {
  const t = useI18n().messages.lineage.collect;
  const router = useRouter();
  const { run, pending } = useAction(collectMetricsNow, {
    successMessage: t.queued,
    onSuccess: () => {
      // The job takes a few seconds; look again once.
      setTimeout(() => router.refresh(), 8000);
    },
  });
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canManage || pending}
        title={canManage ? t.hint : t.role}
        onClick={() => void run({ publicationId })}
      >
        <RefreshCwIcon aria-hidden="true" className="size-4" /> {t.button}
      </Button>
      {!canManage ? <p className="text-xs text-muted-foreground">{t.role}</p> : null}
    </div>
  );
}
