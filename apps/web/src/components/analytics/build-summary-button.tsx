"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { buildPerformanceSummaryAction } from "@/server/actions/analytics";

/** "Build now" on the Learning summary (M7-03): starts J15; the page shows the result once built. */
export function BuildSummaryButton() {
  const { messages } = useI18n();
  const t = messages.analytics.summary;
  const [started, setStarted] = useState(false);
  const run = useAction(buildPerformanceSummaryAction, {
    onSuccess: () => {
      setStarted(true);
      toast.success(t.building);
    },
  });
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={run.pending || started}
      onClick={() => void run.run({})}
    >
      <RefreshCwIcon /> {t.build}
    </Button>
  );
}
