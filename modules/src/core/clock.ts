/** Injectable time source; services never call `new Date()` directly. */
export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

/** Test clock: fixed until advanced. */
export function manualClock(start: Date | string = "2026-01-01T00:00:00Z") {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    set: (date: Date | string) => {
      current = new Date(date);
    },
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}
