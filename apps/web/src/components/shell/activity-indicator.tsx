"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { pollDelay } from "@/lib/progress-model";
import { getActivity } from "@/server/actions/progress";

/**
 * The header's small sign that something is being made (M6-10), like the publishing indicator. The
 * layout gives the count it saw; while it is above zero the indicator asks again (slower the
 * longer it has been watching, not while the tab is hidden) and hides at zero. A run started
 * from a page refreshes the layout, which gives a new count.
 */
export function ActivityIndicator({ running }: { running: number }) {
  const t = useI18n().messages.shell.activity;
  const [count, setCount] = useState(running);
  useEffect(() => setCount(running), [running]);

  const active = count > 0;
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const ask = async () => {
      if (stopped) return;
      if (document.visibilityState !== "hidden") {
        const result = await getActivity({}).catch(() => null);
        if (stopped) return;
        if (result?.ok) {
          setCount(result.data.running);
          if (result.data.running === 0) return;
        }
      }
      timer = setTimeout(() => void ask(), pollDelay(Date.now() - started) * 2);
    };
    timer = setTimeout(() => void ask(), pollDelay(0) * 2);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);

  if (!active) return null;
  return (
    <Badge
      variant="outline"
      role="status"
      title={t.title}
      data-testid="activity-indicator"
      className="gap-1 font-normal"
    >
      <LoaderCircleIcon
        aria-hidden="true"
        className="size-3 animate-spin motion-reduce:animate-none"
      />
      {format(t.label, { n: count })}
    </Badge>
  );
}
