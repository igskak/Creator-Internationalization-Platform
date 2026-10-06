"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { getStatuses } from "@/server/actions/statuses";

const IN_PROGRESS = new Set(["PENDING_UPLOAD", "UPLOADED", "QUEUED", "PROCESSING"]);
const EVERY_MS = 3000;

/**
 * Polls `getStatuses` every 3 seconds while a listed source is being processed, and refreshes the
 * page when a status or the progress changes (plan 10 §10.5). Renders nothing.
 */
export function SourcesPoller({
  sources,
}: {
  sources: { id: string; status: string; percent: number | null }[];
}) {
  const router = useRouter();
  const known = useRef(new Map<string, string>());
  known.current = new Map(sources.map((s) => [s.id, `${s.status}:${s.percent ?? ""}`]));
  const watching = sources.filter((s) => IN_PROGRESS.has(s.status)).map((s) => s.id);
  const key = watching.join(",");

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    let stopped = false;
    const tick = async () => {
      const result = await getStatuses({ sourceIds: ids }).catch(() => null);
      if (stopped || !result?.ok) return;
      const changed = ids.some((id) => {
        const entry = result.data[id];
        return entry && `${entry.status}:${entry.progress ?? ""}` !== known.current.get(id);
      });
      if (changed) router.refresh();
    };
    const timer = setInterval(tick, EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [key, router]);
  return null;
}
