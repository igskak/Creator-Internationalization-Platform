import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ConflictError, InvalidStateError, ValidationError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRenderInput } from "../../visuals";
import { approveVariant, hashSnapshot, verifyApprovedVersion } from "./approve";
import { unapproveVariant } from "./decisions";
import { editVariantField } from "./edit";
import { type ReviewFixture, reviewFixture } from "./test-support";

// approveVariant (M4-06): every guard, the snapshot and its binding to the render.

describe("approveVariant", () => {
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

  const approve = async (
    variantId: string,
    checklist: { factsChecked: boolean; safetyChecked?: boolean; manychatConfigured?: boolean } = {
      factsChecked: true,
    },
    lockVersion?: number,
  ) =>
    approveVariant(fx.ctx, {
      variantId,
      lockVersion: lockVersion ?? (await fx.variant(variantId)).lockVersion,
      checklist,
    });
  const ready = async (opts: Parameters<ReviewFixture["makeVariant"]>[0] = {}) => {
    const made = await fx.makeVariant(opts);
    const renderId = await fx.makeRender(made.variantId);
    return { ...made, renderId };
  };
  const blockers = async (variantId: string) => {
    const error = await approve(variantId).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidStateError);
    return (error.details.blockers as { code: string; flag?: string }[]).map(
      (b) => b.flag ?? b.code,
    );
  };

  it("approves a clean draft: snapshot, version, status, review event and audit", async () => {
    const { variantId, renderId } = await ready();
    const before = await fx.variant(variantId);
    // The render is the one of the current content.
    const [render] = await t.db
      .select()
      .from(schema.carouselRenders)
      .where(eq(schema.carouselRenders.id, renderId));
    expect(render?.inputHash).toBe((await loadRenderInput(fx.ctx, variantId)).inputHash);

    const result = await approve(variantId);
    expect(result).toMatchObject({ versionNo: 1 });
    expect(result.variant).toMatchObject({
      status: "APPROVED",
      approvedVersionId: result.versionId,
      lockVersion: before.lockVersion + 1,
    });
    const [version] = await t.db
      .select()
      .from(schema.contentVariantVersions)
      .where(eq(schema.contentVariantVersions.id, result.versionId));
    expect(version).toMatchObject({
      contentVariantId: variantId,
      versionNo: 1,
      carouselRenderId: renderId,
      approvedBy: fx.userId,
    });
    expect(version?.snapshot).toMatchObject({
      hook: "Hola",
      caption: "Un pie de foto.",
      hashtags: ["#cocina"],
      cta: { type: "SAVE", text: "Guárdalo" },
      templateSequence: ["A", "B", "F"],
      renderId,
      generationVersion: "1.2.0",
    });
    expect(version?.snapshot.slides).toHaveLength(3);
    expect(version?.snapshot.renderedSlideKeys).toEqual(
      [0, 1, 2].map((i) => `renders/${variantId}/${renderId}/${i}.jpg`),
    );
    // The hash is the snapshot's, and the version agrees with its render.
    expect(version?.contentHash).toBe(hashSnapshot(version?.snapshot as never));
    expect(await verifyApprovedVersion(fx.ctx, result.versionId)).toEqual({
      ok: true,
      problems: [],
    });

    const [event] = await t.db
      .select()
      .from(schema.reviewEvents)
      .where(eq(schema.reviewEvents.contentVariantId, variantId));
    expect(event).toMatchObject({
      action: "APPROVE",
      reviewerId: fx.userId,
      variantLockVersion: before.lockVersion,
      editedValue: { versionId: result.versionId, versionNo: 1 },
    });
    const [audit] = await t.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, variantId));
    expect(audit).toMatchObject({
      action: "variant.approved",
      data: { versionId: result.versionId, renderId, from: "READY_FOR_REVIEW", to: "APPROVED" },
    });
  });

  it("notices a version that no longer matches its render or its hash", async () => {
    const { variantId } = await ready();
    const { versionId } = await approve(variantId);
    const [version] = await t.db
      .select()
      .from(schema.contentVariantVersions)
      .where(eq(schema.contentVariantVersions.id, versionId));
    await t.db
      .update(schema.contentVariantVersions)
      .set({ snapshot: { ...(version?.snapshot as object), caption: "Cambiado" } as never })
      .where(eq(schema.contentVariantVersions.id, versionId));
    expect((await verifyApprovedVersion(fx.ctx, versionId)).problems).toEqual([
      "The stored hash does not match the snapshot.",
    ]);
    await t.db
      .update(schema.contentVariantVersions)
      .set({ snapshot: version?.snapshot as never })
      .where(eq(schema.contentVariantVersions.id, versionId));
    await t.db.delete(schema.renderedSlides).where(eq(schema.renderedSlides.slideIndex, 2));
    expect((await verifyApprovedVersion(fx.ctx, versionId)).problems).toEqual([
      "The images of the render are not the ones in the snapshot.",
    ]);
  });

  it("refuses without a render, with a stale one, and while one runs", async () => {
    const none = await fx.makeVariant();
    expect(await blockers(none.variantId)).toEqual(["RENDER_MISSING"]);

    const stale = await ready({ marketCode: "en" });
    await editVariantField(fx.ctx, {
      variantId: stale.variantId,
      lockVersion: (await fx.variant(stale.variantId)).lockVersion,
      field: "slides.s2.slots.body",
      value: "Texto nuevo.",
    });
    expect(await blockers(stale.variantId)).toEqual(["RENDER_STALE"]);

    const running = await fx.makeVariant({ marketCode: "fr-FR" });
    await t.db.insert(schema.carouselRenders).values({
      contentVariantId: running.variantId,
      inputHash: "x",
      status: "RENDERING",
      templatesVersion: "t",
    });
    expect(await blockers(running.variantId)).toEqual(["RENDER_RUNNING"]);
  });

  it("refuses a failed render, a blocking flag, and a commercial idea without an offer", async () => {
    const failed = await fx.makeVariant();
    await t.db.insert(schema.carouselRenders).values({
      contentVariantId: failed.variantId,
      inputHash: "y",
      status: "FAILED",
      templatesVersion: "t",
    });
    expect(await blockers(failed.variantId)).toEqual(["RENDER_FAILED"]);

    for (const flag of ["UNSUPPORTED_CLAIM", "NUMERIC_MISMATCH", "KNOWLEDGE_ARCHIVED"]) {
      const flagged = await ready({ flags: [flag], marketCode: "en" });
      expect(await blockers(flagged.variantId)).toEqual([flag]);
      await t.db
        .update(schema.contentVariants)
        .set({ status: "REJECTED" })
        .where(eq(schema.contentVariants.id, flagged.variantId));
    }

    const commercial = await ready({ commercial: true, marketCode: "fr-FR" });
    expect(await blockers(commercial.variantId)).toEqual(["OFFER_MISSING"]);
    const withOffer = await ready({ commercial: true, withOffer: true });
    expect((await approve(withOffer.variantId)).variant.status).toBe("APPROVED");
  });

  it("needs every box of the checklist: facts always, safety and ManyChat when they apply", async () => {
    const plain = await ready();
    const error = await approve(plain.variantId, { factsChecked: false }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors).toHaveProperty(["checklist.factsChecked"]);

    const safety = await ready({ flags: ["SAFETY_REVIEW"], marketCode: "en" });
    await expect(approve(safety.variantId, { factsChecked: true })).rejects.toMatchObject({
      fieldErrors: { "checklist.safetyChecked": expect.any(Array) },
    });
    await expect(
      approve(safety.variantId, { factsChecked: true, safetyChecked: true }),
    ).resolves.toMatchObject({ versionNo: 1 });

    const keyword = await ready({ ctaType: "COMMENT_KEYWORD", marketCode: "fr-FR" });
    await expect(approve(keyword.variantId, { factsChecked: true })).rejects.toMatchObject({
      fieldErrors: { "checklist.manychatConfigured": expect.any(Array) },
    });
    await expect(
      approve(keyword.variantId, { factsChecked: true, manychatConfigured: true }),
    ).resolves.toMatchObject({ versionNo: 1 });
    expect(await t.db.select().from(schema.contentVariantVersions)).toHaveLength(2);
  });

  it("refuses a stale lock version and a status that cannot be approved", async () => {
    const { variantId } = await ready();
    const lock = (await fx.variant(variantId)).lockVersion;
    await expect(approve(variantId, { factsChecked: true }, lock + 3)).rejects.toThrow(
      ConflictError,
    );
    const changes = await fx.makeVariant({ status: "CHANGES_REQUESTED", marketCode: "en" });
    await fx.makeRender(changes.variantId);
    await expect(approve(changes.variantId)).rejects.toThrow(InvalidStateError);
    expect((await fx.variant(changes.variantId)).status).toBe("CHANGES_REQUESTED");
    expect(await t.db.select().from(schema.contentVariantVersions)).toEqual([]);
  });

  it("stops a draft that no longer passes the blocking checks, even without a flag", async () => {
    const { variantId } = await ready();
    const slides = (await fx.variant(variantId)).slidesJson;
    // Slipped into the database around the edit path: 80 characters in a 70-character slot.
    (slides[0] as (typeof slides)[number]).slots.headline = "x".repeat(80);
    await t.db
      .update(schema.contentVariants)
      .set({ slidesJson: slides })
      .where(eq(schema.contentVariants.id, variantId));
    await fx.makeRender(variantId);
    const error = await approve(variantId).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidStateError);
    expect(error.message).toMatch(/no longer passes/);
    expect(error.details.issues[0]).toMatchObject({ code: "SLOT_OVERFLOW" });
  });

  it("approves again after the approval was withdrawn: version 2, version 1 kept", async () => {
    const { variantId } = await ready();
    const first = await approve(variantId);
    await unapproveVariant(fx.ctx, { variantId, reason: "Wrong offer" });
    expect(await fx.variant(variantId)).toMatchObject({
      status: "READY_FOR_REVIEW",
      approvedVersionId: null,
    });
    await fx.makeRender(variantId).catch(() => undefined);
    const second = await approve(variantId);
    expect(second.versionNo).toBe(2);
    expect(second.versionId).not.toBe(first.versionId);
    expect((await fx.variant(variantId)).approvedVersionId).toBe(second.versionId);
    expect(
      (await t.db.select().from(schema.contentVariantVersions)).map((v) => v.versionNo).sort(),
    ).toEqual([1, 2]);
  });

  describe("campaigns of commercial posts", () => {
    const commercial = async (marketCode?: string) => {
      const made = await fx.makeVariant({
        commercial: true,
        withOffer: true,
        ...(marketCode ? { marketCode } : {}),
      });
      await fx.makeRender(made.variantId);
      return made;
    };

    it("gives an approved commercial post its campaign id and UTM link, in the row and in the snapshot", async () => {
      const { variantId } = await commercial();
      const result = await approve(variantId);
      const row = await fx.variant(variantId);
      expect(row.campaignId).toMatch(/^rc-es-261010-[a-z0-9]{6}$/);
      expect(row.utmJson).toMatchObject({
        source: "instagram",
        medium: "social",
        campaign: row.campaignId,
        content: variantId.replaceAll("-", "").slice(0, 8),
      });
      expect(row.utmJson?.url).toContain("https://example.test/guide?utm_source=instagram");
      const [version] = await t.db
        .select()
        .from(schema.contentVariantVersions)
        .where(eq(schema.contentVariantVersions.id, result.versionId));
      expect(version?.snapshot).toMatchObject({
        campaignId: row.campaignId,
        utm: row.utmJson,
        offerId: row.offerId,
      });
      expect(await verifyApprovedVersion(fx.ctx, result.versionId)).toMatchObject({ ok: true });
      const [audit] = await t.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "variant.approved"));
      expect(audit?.data).toMatchObject({ campaignId: row.campaignId });
    });

    it("keeps the campaign id when the approval is withdrawn and given again", async () => {
      const { variantId } = await commercial();
      await approve(variantId);
      const first = (await fx.variant(variantId)).campaignId;
      await unapproveVariant(fx.ctx, { variantId, reason: "Wrong offer" });
      // The content is the same, so the render of the first approval is still the current one.
      const second = await approve(variantId);
      expect((await fx.variant(variantId)).campaignId).toBe(first);
      const [version] = await t.db
        .select()
        .from(schema.contentVariantVersions)
        .where(eq(schema.contentVariantVersions.id, second.versionId));
      expect(version?.snapshot.campaignId).toBe(first);
    });

    it("gives two commercial posts different ids", async () => {
      const a = await commercial();
      const b = await commercial("en");
      await approve(a.variantId);
      await approve(b.variantId);
      const [va, vb] = [await fx.variant(a.variantId), await fx.variant(b.variantId)];
      expect(va.campaignId).not.toBe(vb.campaignId);
      expect(vb.campaignId).toMatch(/^rc-en-/);
    });

    it("leaves a post that sells nothing without a campaign", async () => {
      const { variantId } = await ready();
      const result = await approve(variantId);
      const row = await fx.variant(variantId);
      expect(row).toMatchObject({ campaignId: null, utmJson: null });
      const [version] = await t.db
        .select()
        .from(schema.contentVariantVersions)
        .where(eq(schema.contentVariantVersions.id, result.versionId));
      expect(version?.snapshot.campaignId).toBeUndefined();
      expect(version?.snapshot.utm).toBeUndefined();
    });
  });

  it("only a person can approve", async () => {
    const { variantId } = await ready();
    const lockVersion = (await fx.variant(variantId)).lockVersion;
    await expect(
      approveVariant(
        { ...fx.ctx, actor: { type: "SYSTEM" } },
        { variantId, lockVersion, checklist: { factsChecked: true } },
      ),
    ).rejects.toThrow(/Only a person/);
    expect((await fx.variant(variantId)).status).toBe("READY_FOR_REVIEW");
  });
});
