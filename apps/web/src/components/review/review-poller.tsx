"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";
import { getStatuses } from "@/server/actions/statuses";

const EVERY_MS = 3000;
const GIVE_UP_MS = 15 * 60 * 1000;

/**
 * Polls `getStatuses` every 3 seconds while a draft is being written (or waits for the job to
 * start) and refreshes the page when a status or the running stage changes (plan 10 §10.5). While
 * a carousel is rendering (or stale after an edit), or a Reel is being made or rebuilt, the page
 * is refreshed too, so the new images or the video appear; both stop after 15 minutes.
 *
 * A refresh is never started while the previous one is still on its way: the review page takes a
 * few seconds to render on a slow database, and a refresh that is replaced by the next one before
 * it arrives is thrown away, so with a plain timer the page could stay frozen (M8-07a, found by
 * the Reel E2E spec). A tick that finds the last refresh still pending is skipped.
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

  const [refreshing, startRefresh] = useTransition();
  const refreshingNow = useRef(false);
  refreshingNow.current = refreshing;
  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  // Refreshing while something is being rendered: every 3 s, but not while the last one is still
  // on its way.
  useEffect(() => {
    if (!rendering) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > GIVE_UP_MS) clearInterval(timer);
      else if (!refreshingNow.current) refresh();
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [rendering, refresh]);

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    let stopped = false;
    const tick = async () => {
      if (refreshingNow.current) return;
      const result = await getStatuses({ variantIds: ids }).catch(() => null);
      if (stopped || !result?.ok) return;
      const changed = ids.some((id) => {
        const entry = result.data[id];
        // Any move out of the state the page shows, or a stage change, is worth a refresh.
        return entry && entry.status !== known.current.get(id);
      });
      if (changed && !refreshingNow.current) refresh();
    };
    const timer = setInterval(tick, EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [key, refresh]);
  return null;
}
