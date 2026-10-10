"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { getStatuses } from "@/server/actions/statuses";

const EVERY_MS = 3000;
const GIVE_UP_MS = 15 * 60 * 1000;

/**
 * Polls `getStatuses` every 3 seconds while a draft is being written (or waits for the job to
 * start) and refreshes the page when a status or the running stage changes (plan 10 §10.5). While
 * a carousel is rendering (or stale after an edit) the page is refreshed every 3 seconds too, so
 * the new images appear; both stop after 15 minutes.
 */
export function ReviewPoller({
  variants,
}: {
  variants: { id: string; status: string; inProgress: boolean; rendering?: boolean }[];
}) {
  const router = useRouter();
  const known = useRef(new Map<string, string>());
  known.current = new Map(variants.map((v) => [v.id, v.status]));
  const key = variants
    .filter((v) => v.inProgress)
    .map((v) => v.id)
    .join(",");
  const rendering = variants.some((v) => v.rendering);

  useEffect(() => {
    if (!rendering) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > GIVE_UP_MS) clearInterval(timer);
      else router.refresh();
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [rendering, router]);

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
