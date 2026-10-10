import { schema } from "@rc/db";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getReviewBundle } from "../pipeline/review";
import { type ReviewFixture, reviewFixture } from "./test-support";

// What the review screen gets besides the text: the allowed actions and the regenerations that
// wait for Keep or Undo (M4-05).

describe("review bundle: allowed actions and pending regenerations", () => {
  let t: TestDb;
  let fx: ReviewFixture;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reviewFixture(t.db);
  });
  afterEach(async () => {
    await t.close();
  });

  const first = async (ideaId: string, role: "owner" | "editor" | "chef" = "owner") =>
    (await getReviewBundle(fx.as(role), ideaId)).variants[0];

  it("lists the actions of the status, with why approval is blocked until the render is current", async () => {
    const { variantId } = await fx.makeVariant();
    const idea = (await fx.variant(variantId)).masterIdeaId;
    const before = await first(idea);
    const approve = before?.allowed.find((a) => a.action === "approve");
    expect(approve).toMatchObject({ enabled: false, checklist: ["factsChecked"] });
    expect(approve?.blockers.map((b) => b.code)).toEqual(["RENDER_MISSING"]);
    expect(before?.allowed.map((a) => a.action)).toEqual([
      "edit",
      "regenerateField",
      "regenerate",
      "requestChanges",
      "approve",
      "reject",
    ]);

    await fx.makeRender(variantId);
    const after = await first(idea);
    expect(after?.render.state).toBe("READY");
    expect(after?.allowed.find((a) => a.action === "approve")?.enabled).toBe(true);
  });

  it("blocks approval on a blocking flag and on a commercial idea without an offer", async () => {
    const flagged = await fx.makeVariant({ flags: ["NUMERIC_MISMATCH"] });
    await fx.makeRender(flagged.variantId);
    const view = await first((await fx.variant(flagged.variantId)).masterIdeaId);
    expect(view?.allowed.find((a) => a.action === "approve")?.blockers).toMatchObject([
      { code: "BLOCKING_FLAG", flag: "NUMERIC_MISMATCH" },
    ]);

    const commercial = await fx.makeVariant({ commercial: true, marketCode: "en" });
    await fx.makeRender(commercial.variantId);
    const c = await first((await fx.variant(commercial.variantId)).masterIdeaId);
    expect(c?.allowed.find((a) => a.action === "approve")?.blockers.map((b) => b.code)).toEqual([
      "OFFER_MISSING",
    ]);
  });

  it("tells a chef they cannot schedule an approved variant", async () => {
    const { variantId } = await fx.makeVariant({ status: "APPROVED" });
    const idea = (await fx.variant(variantId)).masterIdeaId;
    const asChef = await first(idea, "chef");
    expect(asChef?.allowed.find((a) => a.action === "schedule")).toMatchObject({
      enabled: false,
      blockers: [{ code: "ROLE" }],
    });
    const asEditor = await first(idea, "editor");
    expect(asEditor?.allowed.find((a) => a.action === "schedule")?.enabled).toBe(true);
  });

  it("returns a regeneration until a later edit of the same field answers it", async () => {
    const { variantId } = await fx.makeVariant();
    const idea = (await fx.variant(variantId)).masterIdeaId;
    let tick = 0;
    const event = (
      field: string,
      action: "EDIT" | "REGENERATE",
      original: unknown,
      edited: unknown,
    ) => {
      tick += 1;
      return t.db
        .insert(schema.reviewEvents)
        .values({
          contentVariantId: variantId,
          action,
          field,
          originalValue: original,
          editedValue: edited,
          variantLockVersion: 0,
          reasonCode: "WEAK_HOOK",
          createdAt: new Date(fx.clock.now().getTime() + tick * 1000),
        })
        .returning();
    };

    await event("hook", "REGENERATE", "Hola", "Nuevo gancho");
    await event("caption", "REGENERATE", "A", "B");
    await event("caption", "EDIT", "B", "A"); // Undo of the caption
    await event("hashtags", "EDIT", ["#a"], ["#b"]);
    const view = await first(idea);
    expect(view?.regenerations).toHaveLength(1);
    expect(view?.regenerations[0]).toMatchObject({
      field: "hook",
      original: "Hola",
      edited: "Nuevo gancho",
      reasonCode: "WEAK_HOOK",
    });
    // A newer regeneration of the same field replaces the older one.
    await event("hook", "REGENERATE", "Nuevo gancho", "Otro gancho");
    expect((await first(idea))?.regenerations.map((r) => r.edited)).toEqual(["Otro gancho"]);
  });
});
