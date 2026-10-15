"use client";

import type { DraftProgress } from "@rc/modules/content";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { isActive, pollDelay } from "@/lib/progress-model";
import { getProgress } from "@/server/actions/progress";

// What the progress panels of the review page share (M6-10): the steps of every draft of the idea,
// read from the database by one action. The page is rendered with the first answer; while anything
// is waiting or running, the provider asks again (every 3 s at first, then slower, and not while the
// tab is hidden) and stops when everything has settled, then refreshes the page data once.

type Value = { byVariant: ReadonlyMap<string, DraftProgress>; usualMs: number | null };
const Context = createContext<Value | null>(null);

/** The progress of one draft; null when it is not known (or outside a provider). */
export function useDraftProgress(
  variantId: string,
): { progress: DraftProgress; usualMs: number | null } | null {
  const value = useContext(Context);
  const progress = value?.byVariant.get(variantId);
  return value && progress ? { progress, usualMs: value.usualMs } : null;
}

export function ReviewProgressProvider({
  ideaId,
  initial,
  usualMs,
  shown,
  children,
}: {
  ideaId: string;
  initial: DraftProgress[];
  usualMs: number | null;
  /** The statuses the server-rendered page shows; a different one means the page is out of date. */
  shown: Record<string, string>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  // A new server render (after a refresh or an action) is the newer truth.
  useEffect(() => setItems(initial), [initial]);

  const [refreshing, startRefresh] = useTransition();
  const refreshingNow = useRef(false);
  refreshingNow.current = refreshing;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const active = items.some(isActive);
  const wasActive = useRef(active);

  const refresh = useCallback(() => {
    // A refresh that is replaced by the next one before it arrives is thrown away, and the review
    // page can take seconds to render: never start one while the last is on its way.
    if (!refreshingNow.current) startRefresh(() => router.refresh());
  }, [router]);

  useEffect(() => {
    if (!active) return;
    const startedWatching = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const ask = async () => {
      if (stopped) return;
      if (document.visibilityState === "hidden") return schedule();
      const result = await getProgress({ ideaId }).catch(() => null);
      if (stopped) return;
      if (result?.ok) {
        setItems(result.data);
        const outOfDate = result.data.some(
          (p) =>
            shownRef.current[p.variantId] !== undefined &&
            shownRef.current[p.variantId] !== p.status,
        );
        if (outOfDate) refresh();
        // Settled: the effect below refreshes the page once and this loop ends with it.
        if (!result.data.some(isActive)) return;
      }
      schedule();
    };
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(() => void ask(), pollDelay(Date.now() - startedWatching));
    };
    // Back on the tab after a while: look at once.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, ideaId, refresh]);

  // Work that ended while the page was open: the page data has to follow.
  useEffect(() => {
    if (wasActive.current && !active) refresh();
    wasActive.current = active;
  }, [active, refresh]);

  const value = useMemo<Value>(
    () => ({ byVariant: new Map(items.map((p) => [p.variantId, p])), usualMs }),
    [items, usualMs],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
