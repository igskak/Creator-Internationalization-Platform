import { schema } from "@rc/db";
import type { VisualBrief } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, ValidationError } from "@rc/lib/errors";
import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInlineJobRunner, createServiceContext, type ServiceContext } from "../../core";
import { jobHandlers } from "../../job-handlers";
import { scriptedBrief, seedAcceptedIdea, textOfRequest } from "../pipeline/scripted-model";
import {
  RegenerateFieldPayload,
  requestFieldRegeneration,
  runFieldRegeneration,
} from "./regenerate";
import {
  type RecordedJob,
  type ReviewFixture,
  recordingJobs,
  reviewFixture,
  testLogger,
} from "./test-support";

// Field regeneration (M4-04): the action, the job and the checks, with a scripted model.

type Answer = (path: string, kind: string) => unknown;

describe("regenerateVariantField", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  let jobs: RecordedJob[];
  let cards: [string, string];
  let ideaId: string;
  let llm: ReturnType<typeof createFakeLLMProvider>;
  let answer: Answer;
  let ctx: ServiceContext;

  const fieldOf = (text: string) => {
    const m = /<field path="([^"]+)" kind="([^"]+)"/.exec(text);
    return { path: m?.[1] ?? "", kind: m?.[2] ?? "" };
  };

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const recorder = recordingJobs();
    jobs = recorder.calls;
    fx = await reviewFixture(t.db, { jobs: recorder.runner });
    const seeded = await seedAcceptedIdea(t.db);
    cards = [seeded.card1, seeded.card2];
    ideaId = seeded.ideaId;
    answer = () => "unused";
    llm = createFakeLLMProvider({
      handler: (request) => {
        const { path, kind } = fieldOf(textOfRequest(request));
        return { field: path, value: answer(path, kind), rationale: "Because." };
      },
    });
    ctx = createServiceContext({
      db: t.db,
      logger: testLogger,
      clock: fx.clock,
      llm,
      embeddings: createFakeEmbeddingProvider(),
      storage: fx.storage,
      jobs: recorder.runner,
      actor: { type: "JOB", jobRunId: "job-1" },
    });
  });
  afterEach(async () => {
    await t.close();
  });

  const makeVariant = async (opts: Parameters<ReviewFixture["makeVariant"]>[0] = {}) => {
    const made = await fx.makeVariant({ ...opts, ideaId });
    await t.db
      .update(schema.contentVariants)
      .set({ marketBriefJson: scriptedBrief("es-ES", cards) })
      .where(eq(schema.contentVariants.id, made.variantId));
    return made.variantId;
  };

  const payload = async (
    variantId: string,
    field: string,
    extra: Partial<RegenerateFieldPayload> = {},
  ) =>
    RegenerateFieldPayload.parse({
      variantId,
      field,
      lockVersion: (await fx.variant(variantId)).lockVersion,
      requestId: crypto.randomUUID(),
      requestedBy: fx.userId,
      ...extra,
    });

  const events = (variantId: string) =>
    t.db
      .select()
      .from(schema.reviewEvents)
      .where(eq(schema.reviewEvents.contentVariantId, variantId));

  it("redoes the hook and records a REGENERATE event with both values, the run and the note", async () => {
    const variantId = await makeVariant();
    answer = () => "Deja de lavar el arroz.";
    const before = await fx.variant(variantId);
    const outcome = await runFieldRegeneration(
      ctx,
      await payload(variantId, "hook", {
        instruction: "Start with the verb",
        reasonCode: "WEAK_HOOK",
      }),
    );
    expect(outcome).toMatchObject({ status: "APPLIED", rationale: "Because." });
    const after = await fx.variant(variantId);
    expect(after).toMatchObject({
      hook: "Deja de lavar el arroz.",
      status: "READY_FOR_REVIEW",
      lockVersion: before.lockVersion + 1,
    });
    const [event] = await events(variantId);
    expect(event).toMatchObject({
      action: "REGENERATE",
      field: "hook",
      originalValue: "Hola",
      editedValue: "Deja de lavar el arroz.",
      reviewerId: fx.userId,
      reasonCode: "WEAK_HOOK",
      reason: "Start with the verb",
    });
    expect(event?.generationRunId).toBe(outcome.status === "APPLIED" ? outcome.runId : "");
    // The model saw the note, the reason, the field and the rest of the draft.
    const prompt = textOfRequest(llm.calls[0] as never);
    expect(prompt).toContain("<reviewer_note>\nStart with the verb");
    expect(prompt).toContain('<reason code="WEAK_HOOK">');
    expect(prompt).toContain('<field path="hook" kind="hook">');
    expect(prompt).toContain("Un pie de foto.");
    // The run belongs to the variant.
    const [run] = await t.db
      .select()
      .from(schema.generationRuns)
      .where(eq(schema.generationRuns.id, event?.generationRunId ?? ""));
    expect(run).toMatchObject({ stage: "FIELD_REGENERATION", contentVariantId: variantId });
    // A hook is not on the pictures.
    expect(jobs.filter((j) => j.name === "render-carousel")).toEqual([]);
  });

  it("redoes the caption and the hashtags", async () => {
    const variantId = await makeVariant();
    answer = (_p, kind) =>
      kind === "caption" ? "Un pie nuevo." : ["#arroz", "#cocina", "#risotto"];
    await runFieldRegeneration(ctx, await payload(variantId, "caption"));
    await runFieldRegeneration(ctx, await payload(variantId, "hashtags"));
    expect(await fx.variant(variantId)).toMatchObject({
      caption: "Un pie nuevo.",
      hashtags: ["#arroz", "#cocina", "#risotto"],
    });
    expect((await events(variantId)).map((e) => e.field).sort()).toEqual(["caption", "hashtags"]);
  });

  it("redoes the CTA and keeps its offer", async () => {
    const variantId = await makeVariant({ withOffer: true });
    const offerId = (await fx.variant(variantId)).offerId ?? "";
    await t.db
      .update(schema.contentVariants)
      .set({ ctaJson: { type: "SAVE", text: "Guárdalo", offerId } })
      .where(eq(schema.contentVariants.id, variantId));
    answer = () => ({ type: "COMMENT_KEYWORD", text: "Comenta GUIA", keyword: "GUIA" });
    const outcome = await runFieldRegeneration(ctx, await payload(variantId, "cta"));
    expect(outcome.status).toBe("APPLIED");
    expect(await fx.variant(variantId)).toMatchObject({
      cta: "Comenta GUIA",
      ctaType: "COMMENT_KEYWORD",
      ctaJson: { type: "COMMENT_KEYWORD", keyword: "GUIA", offerId },
    });
  });

  it("redoes one slot and queues the debounced render", async () => {
    const variantId = await makeVariant();
    answer = () => "Dos partes de agua por una de arroz.";
    await runFieldRegeneration(ctx, await payload(variantId, "slides.s2.slots.body"));
    expect((await fx.variant(variantId)).slidesJson[1]?.slots.body).toBe(
      "Dos partes de agua por una de arroz.",
    );
    expect(jobs.at(-1)).toMatchObject({
      name: "render-carousel",
      options: { delaySeconds: 10 },
    });
  });

  it("redoes a whole slide, keeping its id, position and pictures that still fit", async () => {
    const variantId = await makeVariant();
    const [brand] = await t.db.select().from(schema.brands);
    const [asset] = await t.db
      .insert(schema.visualAssets)
      .values({ brandId: brand?.id ?? "", kind: "UPLOADED", status: "READY", storageKey: "k" })
      .returning();
    const slides = (await fx.variant(variantId)).slidesJson;
    slides[1] = {
      ...(slides[1] as (typeof slides)[number]),
      images: { side: { assetId: asset?.id ?? "" } },
    };
    await t.db
      .update(schema.contentVariants)
      .set({ slidesJson: slides })
      .where(eq(schema.contentVariants.id, variantId));
    answer = () => ({
      role: "FACT",
      templateId: "B",
      slots: [
        { slot: "headline", text: "El dato" },
        { slot: "body", text: "Rinde el doble." },
      ],
      knowledgeIds: [cards[0]],
      factual: true,
      altText: "Un bol de arroz.",
    });
    const outcome = await runFieldRegeneration(ctx, await payload(variantId, "slides.s2"));
    expect(outcome.status).toBe("APPLIED");
    const slide = (await fx.variant(variantId)).slidesJson[1];
    expect(slide).toMatchObject({
      id: "s2",
      index: 1,
      templateId: "B",
      slots: { headline: "El dato", body: "Rinde el doble." },
      knowledgeIds: [cards[0]],
      factual: true,
      altText: "Un bol de arroz.",
      images: { side: { assetId: asset?.id } },
    });
    const [event] = await events(variantId);
    expect(event).toMatchObject({ action: "REGENERATE", field: "slides.s2" });
  });

  it("plans a new picture for an image slot and starts only that slot", async () => {
    const variantId = await makeVariant();
    const brief: VisualBrief = {
      concept: "Rice",
      visualStyle: "EDITORIAL_MACRO",
      slides: [
        {
          slideId: "s2",
          slot: "side",
          source: "GENERATE",
          prompt: "Old prompt",
          negativePrompt: "text",
          composition: "Top-down",
          aspect: "1:1",
        },
      ],
      differentiationFromSibling: "n/a",
    };
    await t.db
      .update(schema.contentVariants)
      .set({ visualBriefJson: brief })
      .where(eq(schema.contentVariants.id, variantId));
    answer = () => ({
      prompt: "Rice grains, macro, side light",
      negativePrompt: "text, logo",
      composition: "Low angle",
    });
    const request = await payload(variantId, "slides.s2.images.side");
    const outcome = await runFieldRegeneration(ctx, request);
    expect(outcome.status).toBe("APPLIED");
    const v = await fx.variant(variantId);
    expect(v.visualBriefJson?.slides[0]).toMatchObject({
      prompt: "Rice grains, macro, side light",
      composition: "Low angle",
      source: "GENERATE",
    });
    const [event] = await events(variantId);
    expect(event).toMatchObject({
      action: "REGENERATE",
      field: "slides.s2.images.side",
      originalValue: { prompt: "Old prompt" },
      editedValue: { prompt: "Rice grains, macro, side light" },
    });
    expect(jobs.map((j) => j.name)).toEqual(["generate-visual-assets"]);
    expect(jobs[0]).toMatchObject({
      payload: { variantId, slots: [{ slideId: "s2", slot: "side" }] },
      options: { idempotencyKey: `regen-image:${request.requestId}` },
    });
    expect(prompt(llm)).toContain("<current_picture");
  });

  it("drops the result when the reviewer moved on while the model worked", async () => {
    const variantId = await makeVariant();
    const stale = await payload(variantId, "hook");
    await t.db
      .update(schema.contentVariants)
      .set({ hook: "Cambiado a mano", lockVersion: stale.lockVersion + 1 })
      .where(eq(schema.contentVariants.id, variantId));
    expect(await runFieldRegeneration(ctx, stale)).toEqual({ status: "CONFLICT" });
    expect(llm.calls).toHaveLength(0);
    expect((await fx.variant(variantId)).hook).toBe("Cambiado a mano");
    expect(await events(variantId)).toEqual([]);
    const audits = await t.db.select().from(schema.auditEvents);
    expect(audits.map((a) => a.action)).toContain("variant.field_regeneration_discarded");
  });

  it("repairs once and then gives up on a value that breaks the template limit", async () => {
    const variantId = await makeVariant();
    answer = () => "x".repeat(400);
    const outcome = await runFieldRegeneration(
      ctx,
      await payload(variantId, "slides.s2.slots.body"),
    );
    expect(outcome.status).toBe("FAILED");
    expect(llm.calls).toHaveLength(2); // the answer and one repair
    expect((await fx.variant(variantId)).slidesJson[1]?.slots.body).toBe("Texto.");
    expect(await events(variantId)).toEqual([]);
  });

  it("is repaired when the second answer is good", async () => {
    const variantId = await makeVariant();
    let n = 0;
    answer = () => (n++ === 0 ? "x".repeat(400) : "Corto y bueno.");
    const outcome = await runFieldRegeneration(
      ctx,
      await payload(variantId, "slides.s2.slots.body"),
    );
    expect(outcome.status).toBe("APPLIED");
    expect((await fx.variant(variantId)).slidesJson[1]?.slots.body).toBe("Corto y bueno.");
  });

  it("does not write when the model returns the current value", async () => {
    const variantId = await makeVariant();
    answer = () => "Hola";
    expect((await runFieldRegeneration(ctx, await payload(variantId, "hook"))).status).toBe(
      "UNCHANGED",
    );
    expect(await events(variantId)).toEqual([]);
  });

  it("skips a variant that can no longer be changed and an approved one that was not confirmed", async () => {
    const rejected = await makeVariant({ status: "REJECTED" });
    expect((await runFieldRegeneration(ctx, await payload(rejected, "hook"))).status).toBe(
      "SKIPPED",
    );
    const approved = await makeVariant({ status: "APPROVED", marketCode: "en" });
    expect((await runFieldRegeneration(ctx, await payload(approved, "hook"))).status).toBe(
      "SKIPPED",
    );
    expect(llm.calls).toHaveLength(0);
  });

  it("undoes an approval and cancels the post when the approved variant was confirmed", async () => {
    const variantId = await makeVariant({ status: "SCHEDULED" });
    const { versionId } = await fx.makeVersion(variantId);
    const publicationId = await fx.makePublication(variantId, versionId);
    answer = () => "Un gancho nuevo.";
    const outcome = await runFieldRegeneration(
      ctx,
      await payload(variantId, "hook", { confirmed: true }),
    );
    expect(outcome.status).toBe("APPLIED");
    expect(await fx.variant(variantId)).toMatchObject({
      status: "READY_FOR_REVIEW",
      approvedVersionId: null,
    });
    const [pub] = await t.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.id, publicationId));
    expect(pub?.status).toBe("CANCELLED");
  });

  it("does not hand the model a field that is not there", async () => {
    const variantId = await makeVariant();
    const user = fx.ctx;
    const lockVersion = (await fx.variant(variantId)).lockVersion;
    const ask = (field: string, extra: object = {}) =>
      requestFieldRegeneration(user, { variantId, lockVersion, field, ...extra });
    await expect(ask("visualBrief")).rejects.toThrow(/regenerateVisualBrief/);
    await expect(ask("slides.zz")).rejects.toThrow(ValidationError);
    await expect(ask("slides.s2.slots.nope")).rejects.toThrow(/no slot/);
    await expect(ask("slides.s2.images.side")).rejects.toThrow(/no picture plan/);
    await expect(ask("hook", { reasonCode: "NOPE" })).rejects.toThrow(/not a reason code/);
    await expect(ask("hook", { instruction: "x".repeat(501) })).rejects.toThrow(ValidationError);
    await expect(
      requestFieldRegeneration(user, { variantId, lockVersion: lockVersion + 5, field: "hook" }),
    ).rejects.toThrow(/changed/);
    expect(jobs).toEqual([]);
  });

  it("queues J6 with a key per request, and asks for confirmation on an approved variant", async () => {
    const variantId = await makeVariant();
    const lockVersion = (await fx.variant(variantId)).lockVersion;
    const result = await requestFieldRegeneration(fx.ctx, {
      variantId,
      lockVersion,
      field: "hook",
      instruction: "Shorter",
      reasonCode: "WEAK_HOOK",
    });
    expect(jobs).toEqual([
      {
        name: "regenerate-field",
        payload: {
          variantId,
          field: "hook",
          lockVersion,
          requestId: result.requestId,
          instruction: "Shorter",
          reasonCode: "WEAK_HOOK",
          requestedBy: fx.userId,
        },
        options: { idempotencyKey: `regen:${result.requestId}` },
      },
    ]);
    const audits = await t.db.select().from(schema.auditEvents);
    expect(audits.at(-1)).toMatchObject({
      action: "variant.field_regeneration_requested",
      data: { field: "hook", requestId: result.requestId, hasInstruction: true },
    });

    const approved = await makeVariant({ status: "APPROVED", marketCode: "en" });
    const error = await requestFieldRegeneration(fx.ctx, {
      variantId: approved,
      lockVersion: (await fx.variant(approved)).lockVersion,
      field: "hook",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidStateError);
    expect(error.details).toMatchObject({ requiresConfirmation: true });
    await requestFieldRegeneration(fx.ctx, {
      variantId: approved,
      lockVersion: (await fx.variant(approved)).lockVersion,
      field: "hook",
      confirmed: true,
    });
    expect(jobs).toHaveLength(2);
  });

  it("runs from the action through the job runner", async () => {
    const variantId = await makeVariant();
    answer = () => "Del action al job.";
    const make = (actor: ServiceContext["actor"]): ServiceContext => ({ ...ctx, actor });
    const runner = createInlineJobRunner({
      handlers: jobHandlers,
      mode: "await",
      makeContext: (runId) => ({ ...make({ type: "JOB", jobRunId: runId }), jobs: runner }),
    });
    const user = { ...fx.ctx, llm, embeddings: ctx.embeddings, jobs: runner };
    await requestFieldRegeneration(user, {
      variantId,
      lockVersion: (await fx.variant(variantId)).lockVersion,
      field: "hook",
    });
    expect((await fx.variant(variantId)).hook).toBe("Del action al job.");
    const [event] = await events(variantId);
    expect(event).toMatchObject({ action: "REGENERATE", reviewerId: fx.userId });
  });
});

const prompt = (llm: ReturnType<typeof createFakeLLMProvider>) =>
  textOfRequest(llm.calls[0] as never);
