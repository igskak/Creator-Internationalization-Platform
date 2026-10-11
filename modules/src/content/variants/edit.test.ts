import { schema } from "@rc/db";
import type { Slide } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editVariantField } from "./edit";
import { type RecordedJob, type ReviewFixture, recordingJobs, reviewFixture } from "./test-support";

// editVariantField (M4-03). Synthetic content only.

describe("editVariantField", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  let jobs: RecordedJob[];

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const recorder = recordingJobs();
    jobs = recorder.calls;
    fx = await reviewFixture(t.db, { jobs: recorder.runner });
  });
  afterEach(async () => {
    await t.close();
  });

  const events = (variantId: string) =>
    t.db
      .select()
      .from(schema.reviewEvents)
      .where(eq(schema.reviewEvents.contentVariantId, variantId));

  const edit = async (
    variantId: string,
    field: string,
    value: unknown,
    extra: { reasonCode?: string; reason?: string; confirmed?: boolean } = {},
  ) => {
    const v = await fx.variant(variantId);
    return editVariantField(fx.ctx, {
      variantId,
      lockVersion: v.lockVersion,
      field,
      value,
      ...extra,
    });
  };

  it("edits the hook, records the review event with both values and bumps the lock", async () => {
    const { variantId } = await fx.makeVariant();
    const before = await fx.variant(variantId);
    const result = await edit(variantId, "hook", "  ¿Lavas el arroz?  ", {
      reasonCode: "TOO_LONG",
      reason: "Shorter",
    });
    expect(result.variant).toMatchObject({
      hook: "¿Lavas el arroz?",
      status: "READY_FOR_REVIEW",
      lockVersion: before.lockVersion + 1,
    });
    const [event] = await events(variantId);
    expect(event).toMatchObject({
      id: result.reviewEventId,
      action: "EDIT",
      field: "hook",
      originalValue: "Hola",
      editedValue: "¿Lavas el arroz?",
      reviewerId: fx.userId,
      reasonCode: "TOO_LONG",
      reason: "Shorter",
      variantLockVersion: before.lockVersion,
    });
    const [audit] = await t.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, variantId));
    expect(audit).toMatchObject({ action: "variant.edited", data: { field: "hook" } });
    // The hook is not on the pictures: no render.
    expect(jobs).toEqual([]);
    expect(result.renderQueued).toBe(false);
  });

  it("edits a slot, refreshes the derived columns and queues a debounced render", async () => {
    const { variantId } = await fx.makeVariant();
    const result = await edit(variantId, "slides.s2.slots.body", "Dos partes de agua.");
    const v = result.variant;
    expect(v.slidesJson[1]?.slots.body).toBe("Dos partes de agua.");
    expect(v.contentLength).toMatchObject({ slides: 3 });
    expect(v.templateSequence).toEqual(["A", "B", "F"]);
    const [event] = await events(variantId);
    expect(event).toMatchObject({
      field: "slides.s2.slots.body",
      originalValue: "Texto.",
      editedValue: "Dos partes de agua.",
    });
    expect(result.renderQueued).toBe(true);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: "render-carousel",
      payload: { variantId },
      options: { delaySeconds: 10 },
    });
    expect(jobs[0]?.options?.idempotencyKey).toMatch(new RegExp(`^render:${variantId}:`));
  });

  it("replaces a whole slide with a stored structure, keeping id and position", async () => {
    const { variantId } = await fx.makeVariant();
    const current = (await fx.variant(variantId)).slidesJson[1] as Slide;
    const result = await edit(variantId, "slides.s2", {
      ...current,
      slots: { headline: "Nuevo", body: "Cuerpo." },
    });
    expect(result.variant.slidesJson[1]).toMatchObject({
      id: "s2",
      index: 1,
      slots: { headline: "Nuevo" },
    });
    const [event] = await events(variantId);
    expect(event?.originalValue).toMatchObject({ id: "s2" });
    expect(event?.editedValue).toMatchObject({ slots: { headline: "Nuevo", body: "Cuerpo." } });
  });

  it("does nothing and records nothing when the value is unchanged", async () => {
    const { variantId } = await fx.makeVariant();
    const before = await fx.variant(variantId);
    const result = await edit(variantId, "caption", "Un pie de foto.");
    expect(result.reviewEventId).toBeNull();
    expect(result.variant.lockVersion).toBe(before.lockVersion);
    expect(await events(variantId)).toEqual([]);
  });

  it("refuses a stale lock version and names who changed the draft", async () => {
    const { variantId } = await fx.makeVariant();
    const stale = (await fx.variant(variantId)).lockVersion;
    await t.db
      .update(schema.appUsers)
      .set({ displayName: "Sergey" })
      .where(eq(schema.appUsers.id, fx.userId));
    await edit(variantId, "hook", "Primero");
    const error = await editVariantField(fx.ctx, {
      variantId,
      lockVersion: stale,
      field: "hook",
      value: "Segundo",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toMatch(/changed by Sergey/);
    expect(error.details).toMatchObject({ currentLockVersion: stale + 1, changedBy: "Sergey" });
    expect((await fx.variant(variantId)).hook).toBe("Primero");
    expect(await events(variantId)).toHaveLength(1);
  });

  it("refuses a slot over its template limit and leaves the draft alone", async () => {
    const { variantId } = await fx.makeVariant();
    const error = await edit(variantId, "slides.s1.slots.headline", "x".repeat(80)).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors.value[0]).toMatch(/70/);
    expect((await fx.variant(variantId)).slidesJson[0]?.slots.headline).toBe("Hola");
    expect(await events(variantId)).toEqual([]);
  });

  it("refuses an unknown slot, an unknown slide and an unknown field", async () => {
    const { variantId } = await fx.makeVariant();
    await expect(edit(variantId, "slides.s1.slots.nope", "x")).rejects.toThrow(ValidationError);
    await expect(edit(variantId, "slides.zz.slots.body", "x")).rejects.toThrow(ValidationError);
    await expect(edit(variantId, "title", "x")).rejects.toThrow(ValidationError);
  });

  it("refuses a link or an emoji on a slide, and a caption over 2,200 characters", async () => {
    const { variantId } = await fx.makeVariant();
    await expect(edit(variantId, "slides.s2.slots.body", "Mira www.ejemplo.com")).rejects.toThrow(
      /link/,
    );
    await expect(edit(variantId, "slides.s2.slots.body", "Rico 😀")).rejects.toThrow(/emoji/);
    await expect(edit(variantId, "caption", "a".repeat(2201))).rejects.toThrow(/2200/);
    const ok = await edit(variantId, "caption", "a".repeat(2200));
    expect(ok.variant.caption).toHaveLength(2200);
    expect(ok.variant.contentLength).toMatchObject({ captionChars: 2200 });
  });

  it("allows up to 30 hashtags but warns about the policy of 3 to 5", async () => {
    const { variantId } = await fx.makeVariant();
    const result = await edit(variantId, "hashtags", ["#uno", "#dos"]);
    expect(result.variant.hashtags).toEqual(["#uno", "#dos"]);
    expect(result.warnings.map((w) => w.code)).toContain("HASHTAG_COUNT");
    const many = Array.from({ length: 31 }, (_, i) => `#t${i}`);
    await expect(edit(variantId, "hashtags", many)).rejects.toThrow(ValidationError);
    await expect(edit(variantId, "hashtags", ["#bien", "sin almohadilla"])).resolves.toMatchObject({
      warnings: expect.arrayContaining([expect.objectContaining({ code: "HASHTAG_FORMAT" })]),
    });
  });

  it("refuses a forbidden pattern of the market", async () => {
    const { variantId, marketId } = await fx.makeVariant();
    await t.db
      .update(schema.markets)
      .set({
        forbiddenPatterns: [{ pattern: "milagro", kind: "PHRASE", reason: "no miracle claims" }],
      })
      .where(eq(schema.markets.id, marketId));
    const error = await edit(variantId, "hook", "Un milagro para el arroz").catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fieldErrors.value[0]).toMatch(/milagro/);
  });

  it("flags a number that no card supports, and clears the flag when it is fixed", async () => {
    const { variantId } = await fx.makeVariant();
    const raised = await edit(variantId, "slides.s2.slots.body", "Hornea a 230 °C.");
    expect(raised.variant.flags).toContain("NUMERIC_MISMATCH");
    expect(raised.warnings.map((w) => w.code)).toContain("NUMERIC_MISMATCH");
    const cleared = await edit(variantId, "slides.s2.slots.body", "Hornea hasta dorar.");
    expect(cleared.variant.flags).not.toContain("NUMERIC_MISMATCH");
  });

  it("checks the CTA type, its keyword and the market of its offer", async () => {
    const { variantId } = await fx.makeVariant();
    await expect(edit(variantId, "cta", { type: "BUY_NOW", text: "Compra" })).rejects.toThrow(
      /not a CTA type/,
    );
    await expect(
      edit(variantId, "cta", { type: "COMMENT_KEYWORD", text: "Comenta" }),
    ).rejects.toThrow(/keyword/);
    await expect(
      edit(variantId, "cta", { type: "COMMENT_KEYWORD", text: "Comenta", keyword: "guia" }),
    ).rejects.toThrow(/capitals/);

    const other = await fx.makeVariant({ marketCode: "en", withOffer: true });
    const [offer] = await t.db
      .select()
      .from(schema.offers)
      .where(eq(schema.offers.id, (await fx.variant(other.variantId)).offerId ?? ""));
    await expect(
      edit(variantId, "cta", { type: "LINK_IN_BIO", text: "Enlace", offerId: offer?.id }),
    ).rejects.toThrow(/does not belong to this market/);

    const mine = await fx.makeVariant({ withOffer: true });
    const myOffer = (await fx.variant(mine.variantId)).offerId ?? "";
    const result = await edit(mine.variantId, "cta", {
      type: "COMMENT_KEYWORD",
      text: "Comenta GUIA",
      keyword: "GUIA2",
      offerId: myOffer,
    });
    expect(result.variant).toMatchObject({
      cta: "Comenta GUIA",
      ctaType: "COMMENT_KEYWORD",
      offerId: myOffer,
      ctaJson: { keyword: "GUIA2" },
    });
  });

  it("accepts only a ready picture for an image slot and renders at once", async () => {
    const { variantId } = await fx.makeVariant();
    await expect(
      edit(variantId, "slides.s2.images.side", { assetId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow(/not ready/);
    const [brand] = await t.db.select().from(schema.brands);
    const [asset] = await t.db
      .insert(schema.visualAssets)
      .values({ brandId: brand?.id ?? "", kind: "UPLOADED", status: "READY", storageKey: "k" })
      .returning();
    const result = await edit(variantId, "slides.s2.images.side", { assetId: asset?.id });
    expect(result.variant.slidesJson[1]?.images).toEqual({ side: { assetId: asset?.id } });
    expect(jobs.at(-1)?.options?.delaySeconds).toBeUndefined();
  });

  it("checks the reason code against the taxonomy", async () => {
    const { variantId } = await fx.makeVariant();
    await expect(edit(variantId, "hook", "Nuevo", { reasonCode: "NOPE" })).rejects.toThrow(
      /not a reason code/,
    );
  });

  it("keeps CHANGES_REQUESTED and refuses statuses that cannot be edited", async () => {
    const changes = await fx.makeVariant({ status: "CHANGES_REQUESTED" });
    const result = await edit(changes.variantId, "hook", "Otro");
    expect(result.variant.status).toBe("CHANGES_REQUESTED");
    for (const status of ["GENERATING", "PUBLISHING", "PUBLISHED", "REJECTED"] as const) {
      const { variantId } = await fx.makeVariant({ status });
      await expect(edit(variantId, "hook", "Otro")).rejects.toThrow(InvalidStateError);
    }
    const draft = await fx.makeVariant({ status: "DRAFT" });
    await expect(edit(draft.variantId, "hook", "Otro")).rejects.toThrow(InvalidStateError);
    const empty = await fx.makeVariant();
    await t.db
      .update(schema.contentVariants)
      .set({ slidesJson: [], hook: null, caption: null })
      .where(eq(schema.contentVariants.id, empty.variantId));
    await expect(edit(empty.variantId, "hook", "Otro")).rejects.toThrow(/no draft/);
    await expect(
      editVariantField(fx.ctx, {
        variantId: "00000000-0000-4000-8000-000000000000",
        lockVersion: 0,
        field: "hook",
        value: "x",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("asks for confirmation before undoing an approval", async () => {
    const { variantId } = await fx.makeVariant({ status: "APPROVED" });
    const { versionId } = await fx.makeVersion(variantId);
    const error = await edit(variantId, "caption", "Nuevo pie").catch((e) => e);
    expect(error).toBeInstanceOf(InvalidStateError);
    expect(error.details).toMatchObject({ requiresConfirmation: true, status: "APPROVED" });
    const v = await fx.variant(variantId);
    expect(v).toMatchObject({
      status: "APPROVED",
      caption: "Un pie de foto.",
      approvedVersionId: versionId,
    });
  });

  it("sends an approved variant back to review and cancels its scheduled post", async () => {
    const { variantId } = await fx.makeVariant({ status: "SCHEDULED" });
    const { versionId } = await fx.makeVersion(variantId);
    const publicationId = await fx.makePublication(variantId, versionId);
    const before = await fx.variant(variantId);

    const result = await edit(variantId, "caption", "Nuevo pie", { confirmed: true });
    expect(result.variant).toMatchObject({
      status: "READY_FOR_REVIEW",
      caption: "Nuevo pie",
      approvedVersionId: null,
      lockVersion: before.lockVersion + 1,
    });
    expect(result.cancelledPublicationIds).toEqual([publicationId]);
    const [pub] = await t.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.id, publicationId));
    expect(pub).toMatchObject({ status: "CANCELLED", cancelledBy: fx.userId });
    const actions = (
      await t.db.select({ action: schema.auditEvents.action }).from(schema.auditEvents)
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["publication.cancelled", "variant.approval_invalidated"]),
    );
    const [event] = await events(variantId);
    expect(event).toMatchObject({
      action: "EDIT",
      field: "caption",
      originalValue: "Un pie de foto.",
    });
    // The approved version stays as history.
    expect(await t.db.select().from(schema.contentVariantVersions)).toHaveLength(1);
  });

  it("saves the edit even when the render cannot be queued", async () => {
    const plain = await reviewFixture(t.db);
    const { variantId } = await plain.makeVariant();
    const result = await editVariantField(plain.ctx, {
      variantId,
      lockVersion: 0,
      field: "slides.s2.slots.body",
      value: "Otro texto.",
    });
    expect(result.renderQueued).toBe(false);
    expect(result.variant.slidesJson[1]?.slots.body).toBe("Otro texto.");
  });
});
