"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { getStatuses } from "@/server/actions/statuses";

const EVERY_MS = 3000;

/**
 * Polls `getStatuses` every 3 seconds while a draft is being written (or waits for the job to
 * start) and refreshes the page when a status or the running stage changes (plan 10 §10.5).
 */
export function ReviewPoller({
  variants,
}: {
  variants: { id: string; status: string; inProgress: boolean }[];
}) {
  const router = useRouter();
  const known = useRef(new Map<string, string>());
  known.current = new Map(variants.map((v) => [v.id, v.status]));
  const key = variants
    .filter((v) => v.inProgress)
    .map((v) => v.id)
    .join(",");

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    let stopped = false;
    const tick = async () => {
      const result = await getStatuses({ variantIds: ids }).catch(() => null);
      if (stopped || !result?.ok) return;
      const changed = ids.some((id) => {
        const entry = result.data[id];
        // Any move out of the state the page shows, or a stage change, is worth a refresh.
        return entry && entry.status !== known.current.get(id);
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
