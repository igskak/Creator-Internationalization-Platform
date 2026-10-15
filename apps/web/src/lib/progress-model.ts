import type { DraftProgress } from "@rc/modules/content";

// What both the server-rendered review page and the client poll need to know about progress. Kept
// out of the "use client" modules: a server component cannot call a function from one.

const FAST_MS = 3000;
const MEDIUM_MS = 5000;
const SLOW_MS = 10_000;

/** The delay before the next ask, given how long the work has been watched. */
export function pollDelay(watchedMs: number): number {
  if (watchedMs < 60_000) return FAST_MS;
  if (watchedMs < 5 * 60_000) return MEDIUM_MS;
  return SLOW_MS;
}

/** A draft that is waiting or running (so the page polls and the buttons that start work are off). */
export const isActive = (p: DraftProgress) => p.phase === "queued" || p.phase === "running";
