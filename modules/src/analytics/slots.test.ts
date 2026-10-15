import { describe, expect, it } from "vitest";
import { type ExistingSnapshot, mediaAgeHours, planSnapshot, SLOT_HOURS, slotDueAt } from "./slots";

const PUBLISHED = new Date("2026-10-01T10:00:00Z");
const after = (hours: number) => new Date(PUBLISHED.getTime() + hours * 3_600_000);
const plan = (hours: number, existing: ExistingSnapshot[] = []) =>
  planSnapshot({ publishedAt: PUBLISHED, now: after(hours), existing });

describe("slot times", () => {
  it("are 2 h, 24 h, 3 d, 7 d and 28 d after publishing", () => {
    expect(SLOT_HOURS).toEqual({ H2: 2, D1: 24, D3: 72, D7: 168, D28: 672 });
    expect(slotDueAt(PUBLISHED, "D7").toISOString()).toBe("2026-10-08T10:00:00.000Z");
  });

  it("measure the age in hours to two decimals, never below zero", () => {
    expect(mediaAgeHours(PUBLISHED, after(2.5))).toBe(2.5);
    expect(mediaAgeHours(PUBLISHED, new Date("2026-10-01T10:20:00Z"))).toBe(0.33);
    expect(mediaAgeHours(PUBLISHED, new Date("2026-10-01T09:00:00Z"))).toBe(0);
  });
});

describe("planSnapshot", () => {
  it("has nothing to do before the first slot", () => {
    expect(plan(1.9)).toBeNull();
  });

  it("takes each slot once as it comes, in order", () => {
    const taken: ExistingSnapshot[] = [];
    for (const [hours, slot] of [
      [2.2, "H2"],
      [24.5, "D1"],
      [73, "D3"],
      [169, "D7"],
      [673, "D28"],
    ] as const) {
      const next = plan(hours, taken);
      expect(next?.slot, `at ${hours} h`).toBe(slot);
      taken.push({ slot, ageHours: hours });
      expect(plan(hours, taken), `nothing more at ${hours} h`).toBeNull();
    }
    expect(plan(2000, taken)).toBeNull();
  });

  it("does not take a slot twice, even when the snapshot is early or late", () => {
    expect(plan(30, [{ slot: "H2", ageHours: 2 }])?.slot).toBe("D1");
    expect(plan(30, [{ slot: "D1", ageHours: 30 }])).toBeNull();
  });

  it("flags a slot missed by more than its tolerance, and keeps the true age", () => {
    const onTime = plan(2.5);
    expect(onTime).toMatchObject({ slot: "H2", late: false, ageHours: 2.5 });
    const late = plan(5.5);
    expect(late).toMatchObject({ slot: "H2", late: true, ageHours: 5.5 });
    expect(plan(24 + 12)).toMatchObject({ slot: "D1", late: false });
    expect(plan(24 + 13)).toMatchObject({ slot: "D1", late: true });
  });

  it("makes a single snapshot for a post first looked at on day ten, named for the latest slot reached", () => {
    const next = plan(240);
    expect(next).toMatchObject({ slot: "D7", ageHours: 240, late: true });
    // Now the earlier slots would only repeat what is known: nothing is due until D28.
    const taken: ExistingSnapshot[] = [{ slot: "D7", ageHours: 240 }];
    expect(plan(241, taken)).toBeNull();
    expect(plan(700, taken)?.slot).toBe("D28");
  });

  it("counts a manual snapshot as a measurement of its age", () => {
    // A manual look at 30 h says as much as the D1 slot would: D1 is not collected afterwards.
    expect(plan(31, [{ slot: "MANUAL", ageHours: 30 }])).toBeNull();
    // But a slot older than the manual one is still collected when it comes.
    expect(plan(75, [{ slot: "MANUAL", ageHours: 30 }])?.slot).toBe("D3");
  });

  it("reports when the chosen slot was due, so the oldest can go first", () => {
    expect(plan(30)?.dueAt.toISOString()).toBe("2026-10-02T10:00:00.000Z");
    expect(plan(100)?.dueAt.toISOString()).toBe("2026-10-04T10:00:00.000Z");
  });
});
