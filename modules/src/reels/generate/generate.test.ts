import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, PermanentError, TransientError } from "@rc/lib/errors";
import {
  createFakeVideoProvider,
  type GeneratedShot,
  type ShotHandle,
  type VideoProvider,
} from "@rc/lib/providers/video";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChosenHook, generateReel } from "./generate";
import {
  directorAnswer,
  type ReelFixture,
  reelFixture,
  scriptedLlm,
  stubAssemble,
} from "./test-support";

// The generate-reel job end to end with fakes: a model that answers with the synthetic script, the
// fake video provider and a stub for ffmpeg. Synthetic content only.

describe("generateReel", () => {
  let t: TestDb;
  let fx: ReelFixture;
  let reelId: string;
  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reelFixture(t.db);
    await fx.setEnabled(true);
    const [carousel] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, fx.carouselId));
    const [reel] = await t.db
      .insert(schema.contentVariants)
      .values({
        masterIdeaId: carousel?.masterIdeaId ?? "",
        marketId: carousel?.marketId ?? "",
        format: "REEL",
        status: "DRAFT",
        sourceVariantId: fx.carouselId,
      })
      .returning();
    reelId = reel?.id ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  const reel = async () => fx.variant(reelId);
  const run = (
    requestId = "r1",
    parts: Parameters<ReelFixture["jobCtx"]>[0] = {},
    extra: { hookId?: string } = {},
  ) => {
    const stub = stubAssemble();
    const ctx = fx.jobCtx(parts);
    return {
      stub,
      ctx,
      done: generateReel(
        ctx,
        { variantId: reelId, requestId, ...extra },
        { assemble: stub.assemble },
      ),
    };
  };
  const shots = () => t.db.select().from(schema.reelShots);
  const scripts = () => t.db.select().from(schema.reelScripts);
  const renders = () => t.db.select().from(schema.reelRenders);
  const runsOf = (stage: "REEL_DIRECTION" | "REEL_SHOT") =>
    t.db.select().from(schema.generationRuns).where(eq(schema.generationRuns.stage, stage));

  it("makes the Reel: script, seven shots, a render, and a variant ready for review", async () => {
    const video = createFakeVideoProvider();
    const { stub, done } = run("r1", { video });
    const result = await done;
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ variantId: reelId, status: "READY" });
    expect(result.shots).toEqual({ total: 7, reused: 0, fallbacks: 0 });

    const v = await reel();
    expect(v).toMatchObject({ status: "READY_FOR_REVIEW", pipelineState: null, lastError: null });
    expect(v.currentReelRenderId).toBe(result.renderId);
    // reel-director@2 wrote the Reel's own post: the hook line, then its caption; its ask and tags.
    expect(v.caption).toBe(
      "¿Aún lavas el arroz del risotto? Ahí se va lo meloso.\n\nEl almidón de la superficie es lo que hace el risotto meloso. Si lo lavas, el almidón se va y el arroz queda suelto.\n\nTuesta el arroz en seco 2 min y añade el caldo caliente, un cucharón cada vez, sin dejar de remover.\n\nMándaselo a quien hace el risotto en casa.",
    );
    expect(v).toMatchObject({
      hook: "¿Aún lavas el arroz del risotto?",
      hookType: "MISTAKE_CALLOUT",
      ctaType: "SHARE",
      cta: "Mándaselo a quien hace el risotto en casa.",
      ctaJson: { type: "SHARE", text: "Mándaselo a quien hace el risotto en casa." },
      hashtags: ["#risotto", "#arroz", "#trucosdecocina", "#cocinacasera"],
    });

    const [script] = await scripts();
    expect(script).toMatchObject({
      version: 1,
      chosenHookId: "h1",
      flashOpener: "ON",
      shotModel: "alibaba/wan-3.0",
      promptVersion: "reel-director@2",
    });
    expect(script?.scenes).toHaveLength(7);
    expect(script?.scenes.every((s) => s.shotId)).toBe(true);
    expect(script?.hookOptions.map((h) => h.hookType)).toEqual([
      "MISTAKE_CALLOUT",
      "CURIOSITY_GAP",
      "RELATABLE_PROBLEM",
    ]);

    expect(video.calls).toHaveLength(7);
    const allShots = await shots();
    expect(allShots.every((s) => s.status === "READY" && s.storageKey)).toBe(true);
    // The cards and beats went to the assembly, with the hook card first.
    expect(stub.calls[0]?.scenes[0]).toMatchObject({ id: "s1", beats: 4, layout: "RIGHT" });
    expect(stub.calls[0]?.flashOpener).toBe(true);
    // The placeholder beat goes with it (the file is cut to the 7 scenes and the flash opener).
    expect(stub.calls[0]?.audio).toMatchObject({ kind: "PLACEHOLDER_BEAT" });
    expect(stub.calls[0]?.audio?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(stub.calls[0]?.shots ?? {})).toHaveLength(7);

    const [render] = await renders();
    expect(render).toMatchObject({
      status: "READY",
      reelScriptId: script?.id,
      audioKind: "PLACEHOLDER_BEAT",
      width: 1080,
      height: 1920,
      durationMs: 14_880,
    });
    expect(await fx.storage.head(render?.storageKey ?? "")).not.toBeNull();
    expect(render?.qaReport?.warnings).toEqual([]);
    expect(Number(render?.costUsd)).toBeCloseTo(2.1, 3);

    expect(await runsOf("REEL_DIRECTION")).toHaveLength(1);
    expect(await runsOf("REEL_SHOT")).toHaveLength(7);
    const events = await t.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "reel.generated"));
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      shots: 7,
      reused: 0,
      fallbacks: 0,
      scriptId: script?.id,
    });
  });

  it("goes through the state machine and writes its audit events", async () => {
    await run().done;
    const actions = (await t.db.select().from(schema.auditEvents)).map((e) => e.action);
    expect(actions).toContain("variant.generation_started");
    expect(actions).toContain("variant.generated");
    expect(actions.indexOf("variant.generation_started")).toBeLessThan(
      actions.indexOf("variant.generated"),
    );
  });

  it("refuses to run while the kill switch is off", async () => {
    await fx.setEnabled(false);
    const { done } = run();
    await expect(done).rejects.toMatchObject({ details: { code: "reels_disabled" } });
    expect((await reel()).status).toBe("DRAFT");
    expect(await shots()).toHaveLength(0);
  });

  it("refuses a variant that is not a Reel", async () => {
    const stub = stubAssemble();
    await expect(
      generateReel(
        fx.jobCtx(),
        { variantId: fx.carouselId, requestId: "r1" },
        { assemble: stub.assemble },
      ),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("makes a second request of an unchanged script without paying again or rendering again", async () => {
    const video = createFakeVideoProvider();
    const first = await run("r1", { video }).done;
    const stub = stubAssemble();
    const second = await generateReel(
      fx.jobCtx({ video }),
      { variantId: reelId, requestId: "r2" },
      { assemble: stub.assemble },
    );
    expect(second.status).toBe("READY");
    expect(second.shots).toEqual({ total: 7, reused: 7, fallbacks: 0 });
    expect(video.calls).toHaveLength(7);
    expect(stub.calls).toHaveLength(0);
    expect(second.renderId).toBe(first.renderId);
    expect((await scripts()).map((s) => s.version)).toEqual([1, 2]);
    expect(await runsOf("REEL_DIRECTION")).toHaveLength(2);
    expect((await reel()).status).toBe("READY_FOR_REVIEW");
  });

  it("uses the hook option the caller chose, with its two cards on the first two scenes", async () => {
    const { done } = run("r1", {}, { hookId: "h2" });
    const result = await done;
    expect(result.status).toBe("READY");
    const [script] = await scripts();
    const h2 = script?.hookOptions.find((h) => h.id === "h2");
    expect(script?.chosenHookId).toBe("h2");
    expect(script?.scenes[0]?.card).toBe(h2?.card);
    expect(script?.scenes[1]?.card).toBe(h2?.ruleCard);
  });

  it("resumes after a shot that did not come back in time, paying for no shot twice", async () => {
    const inner = createFakeVideoProvider();
    let stall = true;
    const flaky: VideoProvider = {
      ...inner,
      id: "fake",
      submit: inner.submit,
      waitFor: async (handle: ShotHandle): Promise<GeneratedShot> => {
        if (stall && handle.requestId === lastRequestId) {
          throw new TransientError("Higgsfield is still working on the shot.", {
            details: { code: "timeout" },
          });
        }
        return inner.waitFor(handle);
      },
      generate: inner.generate,
    };
    let lastRequestId = "";
    const submit = inner.submit;
    flaky.submit = async (request) => {
      const handle = await submit(request);
      if (request.label === "s5") lastRequestId = handle.requestId;
      return handle;
    };

    const first = run("r1", { video: flaky });
    await expect(first.done).rejects.toBeInstanceOf(TransientError);
    const midway = await reel();
    expect(midway.status).toBe("GENERATING");
    expect(midway.pipelineState).toMatchObject({
      pipelineRunId: `reel:${reelId}:r1`,
      stage: "SHOTS",
      completedStages: ["DIRECTION"],
    });
    expect((await shots()).map((s) => s.status).sort()).toEqual([
      "READY",
      "READY",
      "READY",
      "READY",
      "READY",
      "READY",
      "RUNNING",
    ]);
    expect(first.stub.calls).toHaveLength(0);

    stall = false;
    const second = await run("r1", { video: flaky }).done;
    expect(second.status).toBe("READY");
    // Seven submissions in all, one director run, and the same script row.
    expect(inner.calls).toHaveLength(7);
    expect(await runsOf("REEL_DIRECTION")).toHaveLength(1);
    expect(await scripts()).toHaveLength(1);
    expect((await reel()).status).toBe("READY_FOR_REVIEW");
  });

  it("falls back to a still prompt for a refused shot and says so", async () => {
    const inner = createFakeVideoProvider();
    const prompts = new Map<string, string>();
    const video: VideoProvider = {
      ...inner,
      submit: async (request) => {
        const handle = await inner.submit(request);
        prompts.set(handle.requestId, request.prompt);
        return handle;
      },
      waitFor: async (handle) => {
        if ((prompts.get(handle.requestId) ?? "").includes("sizzling")) throw nsfw();
        return inner.waitFor(handle);
      },
    };
    const result = await run("r1", { video }).done;
    expect(result.status).toBe("READY");
    expect(result.shots).toMatchObject({ total: 7, fallbacks: 1 });
    expect((await shots()).filter((s) => s.status === "BLOCKED")).toHaveLength(1);
    const event = (
      await t.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, "reel.generated"))
    )[0];
    expect(event?.data).toMatchObject({ fallbacks: 1 });
    const [script] = await scripts();
    const blocked = (await shots()).find((s) => s.status === "BLOCKED");
    expect(script?.scenes.some((sc) => sc.shotId === blocked?.id)).toBe(false);
  });

  it("ends the variant as DRAFT with a flag when the director cannot write a valid script", async () => {
    const broken = directorAnswer(fx.assetIds);
    broken.scenes = broken.scenes.slice(0, 2);
    const video = createFakeVideoProvider();
    const { stub, done } = run("r1", { llm: scriptedLlm(broken), video });
    const result = await done;
    expect(result).toMatchObject({ status: "FAILED", error: { code: "script_invalid" } });
    const v = await reel();
    expect(v).toMatchObject({ status: "DRAFT", pipelineState: null });
    expect(v.flags).toContain("GENERATION_FAILED");
    expect(v.lastError).toMatchObject({ code: "script_invalid" });
    expect(video.calls).toHaveLength(0);
    expect(stub.calls).toHaveLength(0);
    expect(await scripts()).toHaveLength(0);
    const events = await t.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "reel.failed"));
    expect(events).toHaveLength(1);
  });

  it("refuses a second request while one is running", async () => {
    await t.db
      .update(schema.contentVariants)
      .set({
        status: "GENERATING",
        pipelineState: {
          pipelineRunId: `reel:${reelId}:other`,
          stage: "SHOTS",
          startedAt: "2026-10-10T12:00:00.000Z",
          completedStages: [],
          runIds: {},
        },
      })
      .where(eq(schema.contentVariants.id, reelId));
    await expect(run("r1").done).rejects.toMatchObject({ details: { code: "already_generating" } });
    expect(await shots()).toHaveLength(0);
  });

  it("fails the variant, not the job, when the render step breaks for good", async () => {
    const ctx = fx.jobCtx();
    const result = await generateReel(
      ctx,
      { variantId: reelId, requestId: "r1" },
      {
        assemble: async () => {
          throw new Error("ffmpeg exploded");
        },
      },
    );
    expect(result).toMatchObject({ status: "FAILED", error: { message: "ffmpeg exploded" } });
    const [render] = await renders();
    expect(render).toMatchObject({ status: "FAILED", error: { code: "ASSEMBLY_FAILED" } });
    expect((await reel()).status).toBe("DRAFT");
    // The shots were paid for and stay READY for the next try.
    expect((await shots()).every((s) => s.status === "READY")).toBe(true);
  });

  it("keeps the recent hook types of the market out of the next request", async () => {
    await run("r1").done;
    const llm = scriptedLlm(directorAnswer(fx.assetIds));
    await generateReel(
      fx.jobCtx({ llm }),
      { variantId: reelId, requestId: "r2" },
      { assemble: stubAssemble().assemble },
    );
    const text = JSON.stringify(llm.calls[0]?.messages);
    expect(text).toContain('<type code=\\"MISTAKE_CALLOUT\\" n=\\"1\\">');
  });
});

describe("applyChosenHook", () => {
  it("swaps the two cards and the chosen id, and refuses an unknown option", () => {
    const hook = (id: string, card: string, ruleCard: string) => ({
      id,
      hookType: "DIRECT_QUESTION",
      card,
      ruleCard,
      claimSlideIds: ["c1"],
      rationale: "why",
    });
    const scene = (index: number, card: string) => ({
      id: `s${index + 1}`,
      index,
      role: "STEP" as const,
      emotion: "AHA" as const,
      beats: 4,
      card,
      shotPrompt: "x",
      sourcePictureId: "p",
      layout: "RIGHT" as const,
      claimSlideIds: [],
    });
    const script = {
      hookOptions: [hook("h1", "A", "B"), hook("h2", "C", "D")],
      chosenHookId: "h1",
      flashOpener: "ON" as const,
      scenes: [scene(0, "A"), scene(1, "B"), scene(2, "E")],
    };
    const swapped = applyChosenHook(script, "h2");
    expect(swapped.chosenHookId).toBe("h2");
    expect(swapped.scenes.map((s) => s.card)).toEqual(["C", "D", "E"]);
    expect(() => applyChosenHook(script, "h9")).toThrow('There is no hook option "h9"');
  });
});

function nsfw() {
  return new PermanentError("Higgsfield blocked the shot (moderation).", {
    details: { code: "nsfw" },
  });
}
