// Which snapshot a post is due for (plan 06 §6.3 J11, 11 §11.2, M6-03). Pure: dates and lists in,
// a decision out. A snapshot is a measurement with a real age; the slot is only the name of the
// moment it was meant for, so these rules look at ages first.

export const AUTOMATIC_SLOTS = ["H2", "D1", "D3", "D7", "D28"] as const;
export type AutomaticSlot = (typeof AUTOMATIC_SLOTS)[number];
export type SnapshotSlotName = AutomaticSlot | "MANUAL";

/** Hours after publishing at which each slot is due. */
export const SLOT_HOURS: Record<AutomaticSlot, number> = {
  H2: 2,
  D1: 24,
  D3: 72,
  D7: 168,
  D28: 672,
};

/** How late a slot may be before it counts as missed (J11 step 3); a missed one is still stored. */
export const SLOT_TOLERANCE_HOURS: Record<AutomaticSlot, number> = {
  H2: 3,
  D1: 12,
  D3: 24,
  D7: 48,
  D28: 7 * 24,
};

const HOUR_MS = 3_600_000;

/** When a slot is due for a post. */
export const slotDueAt = (publishedAt: Date, slot: AutomaticSlot): Date =>
  new Date(publishedAt.getTime() + SLOT_HOURS[slot] * HOUR_MS);

/** The age of a post in hours at `at`, to two decimals like `metric_snapshots.media_age_hours`. */
export const mediaAgeHours = (publishedAt: Date, at: Date): number =>
  Math.max(0, Math.round(((at.getTime() - publishedAt.getTime()) / HOUR_MS) * 100) / 100);

export type ExistingSnapshot = { slot: SnapshotSlotName; ageHours: number };

export type PlannedSnapshot = {
  slot: AutomaticSlot;
  /** When this slot was due; the oldest due slot is collected first. */
  dueAt: Date;
  /** The age the measurement will have, now. */
  ageHours: number;
  /** The slot was missed by more than its tolerance: still stored, with the true age. */
  late: boolean;
};

/**
 * The one measurement a post is due for now, or null.
 *
 * A slot can be collected when its time has come and no snapshot of the post is already as old as
 * the slot (one measured later says at least as much, so a post first looked at on day ten gets a
 * single snapshot, named for the latest slot it has reached, instead of four copies of the same
 * numbers). Of the slots that can be collected the latest is the one measured: it is the closest
 * to the age the numbers really have.
 */
export function planSnapshot(input: {
  publishedAt: Date;
  now: Date;
  existing: readonly ExistingSnapshot[];
}): PlannedSnapshot | null {
  const ageHours = mediaAgeHours(input.publishedAt, input.now);
  const taken = new Set(input.existing.map((s) => s.slot));
  const newest = Math.max(-1, ...input.existing.map((s) => s.ageHours));
  const collectable = AUTOMATIC_SLOTS.filter(
    (slot) => SLOT_HOURS[slot] <= ageHours && !taken.has(slot) && newest < SLOT_HOURS[slot],
  );
  const slot = collectable.at(-1);
  if (!slot) return null;
  return {
    slot,
    dueAt: slotDueAt(input.publishedAt, slot),
    ageHours,
    late: ageHours - SLOT_HOURS[slot] > SLOT_TOLERANCE_HOURS[slot],
  };
}
