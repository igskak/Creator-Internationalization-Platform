import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInlineJobRunner,
  createServiceContext,
  manualClock,
  type ServiceContext,
} from "../../core";
import { jobHandlers } from "../../job-handlers";
import {
  buildDraftProgress,
  getActivity,
  getDraftProgress,
  type ProgressFacts,
  STALL_AFTER_MS,
  usualDraftDurationMs,
} from "./progress";
import { requestVariants } from "./request";
import {
  marketOfRequest,
  scriptedBrief,
  scriptedDraft,
  scriptedReview,
  seedAcceptedIdea,
} from "./scripted-model";

// Progress of long actions (M6-10): every state of the steps from the facts the pipeline writes,
// then the same read on a real database. Synthetic content only.

const NOW = Date.parse("2026-10-15T12:00:00Z");
const MIN = 60_000;
const ago = (minutes: number) => NOW - minutes * MIN;

const facts = (over: Partial<ProgressFacts> = {}): ProgressFacts => ({
  variantId: "v1",
  marketCode: "es-ES",
  status: "GENERATING",
  hasContent: false,
  pipeline: {
    startedAt: new Date(ago(3)).toISOString(),
    completedStages: [],
  },
  variantUpdatedAt: ago(3),
  lastError: null,
  pictures: { pending: 0, ready: 0, firstAt: null, lastAt: null },
  render: { status: null, at: null, error: null, currentIsReady: false },
  ...over,
});
const states = (p: ReturnType<typeof buildDraftProgress>) =>
  Object.fromEntries(p.steps.map((s) => [s.key, s.state]));

describe("buildDraftProgress", () => {
  it("shows a queued draft with every step to come", () => {
    const p = buildDraftProgress(
      facts({ status: "DRAFT", pipeline: null, variantUpdatedAt: ago(1) }),
      NOW,
    );
    expect(p).toMatchObject({ phase: "queued", startedAt: null, stalled: false });
    expect(Object.values(states(p))).toEqual(Array(6).fill("todo"));
  });

  it("says a queued draft that never starts has stalled", () => {
    const p = buildDraftProgress(
      facts({ status: "DRAFT", pipeline: null, variantUpdatedAt: NOW - STALL_AFTER_MS - 1 }),
      NOW,
    );
    expect(p).toMatchObject({ phase: "queued", stalled: true });
  });

  it("follows the stages in order: done, the current one, the rest", () => {
    const at = (completedStages: string[]) =>
      states(
        buildDraftProgress(
          facts({
            pipeline: { startedAt: new Date(ago(3)).toISOString(), completedStages },
          }),
          NOW,
        ),
      );
    expect(at([])).toMatchObject({ ADAPT: "current", WRITE: "todo" });
    expect(at(["ADAPT"])).toMatchObject({ ADAPT: "done", WRITE: "current", CRITIC: "todo" });
    expect(at(["ADAPT", "WRITE:0"])).toMatchObject({ WRITE: "done", CRITIC: "current" });
    expect(at(["ADAPT", "WRITE:0", "CRITIC:0"])).toMatchObject({
      CRITIC: "done",
      VISUAL: "current",
      PICTURES: "todo",
    });
  });

  it("goes back to the critic after a rewrite and says which rewrite", () => {
    const p = buildDraftProgress(
      facts({
        pipeline: {
          startedAt: new Date(ago(6)).toISOString(),
          completedStages: ["ADAPT", "WRITE:0", "CRITIC:0", "WRITE:1"],
        },
      }),
      NOW,
    );
    expect(states(p)).toMatchObject({ WRITE: "done", CRITIC: "current", VISUAL: "todo" });
    expect(p.steps.find((s) => s.key === "CRITIC")).toMatchObject({ rewrite: 1 });
  });

  it("measures elapsed time from the pipeline start and idleness from the last stage", () => {
    const p = buildDraftProgress(
      facts({
        pipeline: {
          startedAt: new Date(ago(8)).toISOString(),
          updatedAt: new Date(ago(2)).toISOString(),
          completedStages: ["ADAPT"],
        },
      }),
      NOW,
    );
    expect(p).toMatchObject({
      phase: "running",
      startedAt: new Date(ago(8)).toISOString(),
      lastProgressAt: new Date(ago(2)).toISOString(),
      stalled: false,
    });
  });

  it("calls a draft stalled when no stage finished for the limit", () => {
    const slow = buildDraftProgress(
      facts({
        pipeline: {
          startedAt: new Date(ago(40)).toISOString(),
          updatedAt: new Date(NOW - STALL_AFTER_MS - 1).toISOString(),
          completedStages: ["ADAPT"],
        },
      }),
      NOW,
    );
    expect(slow.stalled).toBe(true);
    const fine = buildDraftProgress(
      facts({
        pipeline: {
          startedAt: new Date(ago(40)).toISOString(),
          updatedAt: new Date(NOW - STALL_AFTER_MS + 1).toISOString(),
          completedStages: ["ADAPT"],
        },
      }),
      NOW,
    );
    expect(fine.stalled).toBe(false);
  });

  it("shows a failed draft with the stage that failed and the plain error", () => {
    const p = buildDraftProgress(
      facts({
        status: "DRAFT",
        pipeline: null,
        lastError: {
          code: "INVALID_OUTPUT",
          message: "The WRITE:0 step did not produce a valid answer.",
          details: { stage: "WRITE:0" },
        },
      }),
      NOW,
    );
    expect(p).toMatchObject({
      phase: "failed",
      error: { code: "INVALID_OUTPUT", message: expect.stringContaining("WRITE:0") },
    });
    expect(states(p)).toMatchObject({ ADAPT: "done", WRITE: "failed", CRITIC: "todo" });
  });

  it("shows the pictures with a count, then the render, once the text is written", () => {
    const text = { status: "READY_FOR_REVIEW", hasContent: true, pipeline: null };
    const pictures = buildDraftProgress(
      facts({
        ...text,
        pictures: { pending: 3, ready: 2, firstAt: ago(4), lastAt: ago(1) },
      }),
      NOW,
    );
    expect(pictures.phase).toBe("running");
    expect(states(pictures)).toMatchObject({ VISUAL: "done", PICTURES: "current", RENDER: "todo" });
    expect(pictures.steps.find((s) => s.key === "PICTURES")?.count).toEqual({ done: 2, total: 5 });

    const render = buildDraftProgress(
      facts({
        ...text,
        pictures: { pending: 0, ready: 5, firstAt: null, lastAt: ago(3) },
        render: { status: "RENDERING", at: ago(1), error: null, currentIsReady: false },
      }),
      NOW,
    );
    expect(states(render)).toMatchObject({ PICTURES: "done", RENDER: "current" });
    expect(render.startedAt).toBe(new Date(ago(1)).toISOString());
  });

  it("has nothing to show for a finished draft, even when an older render failed", () => {
    const text = { status: "READY_FOR_REVIEW", hasContent: true, pipeline: null };
    expect(buildDraftProgress(facts(text), NOW).phase).toBe("idle");
    expect(
      buildDraftProgress(
        facts({
          ...text,
          render: { status: "FAILED", at: ago(5), error: "x", currentIsReady: true },
        }),
        NOW,
      ).phase,
    ).toBe("idle");
  });

  it("shows a render that failed when there is no finished render to fall back on", () => {
    const p = buildDraftProgress(
      facts({
        status: "READY_FOR_REVIEW",
        hasContent: true,
        pipeline: null,
        render: { status: "FAILED", at: ago(5), error: "Chromium crashed", currentIsReady: false },
      }),
      NOW,
    );
    expect(p).toMatchObject({
      phase: "failed",
      error: { code: "RENDER_FAILED", message: "Chromium crashed" },
    });
    expect(states(p)).toMatchObject({ PICTURES: "done", RENDER: "failed" });
  });
});

const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

describe("progress on a database", () => {
  let t: TestDb;
  let user: ServiceContext;
  let ideaId: string;
  let brandId: string;
  const clock = manualClock("2026-10-15T12:00:00Z");

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const seeded = await seedAcceptedIdea(t.db);
    ideaId = seeded.ideaId;
    const cards: [string, string] = [seeded.card1, seeded.card2];
    const [owner] = await t.db.select().from(schema.appUsers);
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const llm = createFakeLLMProvider({
      handler: (request) => {
        const market = marketOfRequest(request);
        if (request.meta.promptId === "market-adapter") return scriptedBrief(market, cards);
        if (request.meta.promptId === "content-writer") return scriptedDraft(market, cards, "");
        return scriptedReview({ issues: [] });
      },
    });
    const make = (actor: ServiceContext["actor"], runner?: ServiceContext["jobs"]) =>
      createServiceContext({
        db: t.db,
        logger,
        clock,
        llm,
        embeddings: createFakeEmbeddingProvider(),
        actor,
        ...(runner ? { jobs: runner } : {}),
      });
    const runner: ServiceContext["jobs"] = createInlineJobRunner({
      handlers: {
        ...jobHandlers,
        "render-carousel": { ...jobHandlers["render-carousel"], run: async () => ({}) },
      },
      mode: "await",
      makeContext: (runId) => make({ type: "JOB", jobRunId: runId }, runner),
    });
    user = make({ type: "USER", userId: owner?.id ?? "", role: "owner" }, runner);
  });
  afterEach(async () => {
    await t.close();
  });

  /** The two drafts in market order: Spain, then English. */
  const drafts = async () => {
    const ids = (await getDraftProgress(user, ideaId)).map((p) => p.variantId);
    return ids;
  };

  it("has no drafts to show for an idea without them", async () => {
    expect(await getDraftProgress(user, ideaId)).toEqual([]);
    expect(await getActivity(user)).toEqual({ running: 0 });
    expect(await usualDraftDurationMs(user)).toBeNull();
  });

  it("reads a running draft, its pictures and its render from the rows", async () => {
    await requestVariants(user, { masterIdeaId: ideaId });
    const [es, en] = await drafts();
    if (!es || !en) throw new Error("two drafts expected");
    // The finished run leaves nothing to show.
    expect((await getDraftProgress(user, ideaId)).map((p) => [p.marketCode, p.phase])).toEqual([
      ["es-ES", "idle"],
      ["en", "idle"],
    ]);

    // One market is being made again: three stages done, a minute ago.
    await t.db
      .update(schema.contentVariants)
      .set({
        status: "GENERATING",
        pipelineState: {
          pipelineRunId: "run",
          stage: "CRITIC:0",
          startedAt: new Date(clock.now().getTime() - 4 * MIN).toISOString(),
          updatedAt: new Date(clock.now().getTime() - MIN).toISOString(),
          completedStages: ["ADAPT", "WRITE:0", "CRITIC:0"],
          runIds: {},
        },
      })
      .where(eq(schema.contentVariants.id, es));
    const [running] = await getDraftProgress(user, ideaId);
    expect(running).toMatchObject({ marketCode: "es-ES", phase: "running", stalled: false });
    expect(states(running as never)).toMatchObject({ CRITIC: "done", VISUAL: "current" });
    expect(await getActivity(user)).toEqual({ running: 1 });

    // The other market: text done, two of three pictures made.
    const asset = (status: "PENDING" | "READY", slot: string) => ({
      brandId,
      kind: "GENERATED" as const,
      status,
      contentVariantId: en,
      slideId: "s1",
      slot,
      promptHash: slot,
    });
    await t.db
      .insert(schema.visualAssets)
      .values([asset("READY", "a"), asset("READY", "b"), asset("PENDING", "c")]);
    const second = (await getDraftProgress(user, ideaId))[1];
    expect(second).toMatchObject({ marketCode: "en", phase: "running" });
    expect(second?.steps.find((s) => s.key === "PICTURES")).toMatchObject({
      state: "current",
      count: { done: 2, total: 3 },
    });

    // Pictures done, the render started.
    await t.db
      .update(schema.visualAssets)
      .set({ status: "READY" })
      .where(eq(schema.visualAssets.contentVariantId, en));
    await t.db.insert(schema.carouselRenders).values({
      contentVariantId: en,
      inputHash: "h-new",
      status: "RENDERING",
      templatesVersion: "t1",
    });
    const third = (await getDraftProgress(user, ideaId))[1];
    expect(states(third as never)).toMatchObject({ PICTURES: "done", RENDER: "current" });
    expect(await getActivity(user)).toEqual({ running: 2 });
  });

  it("shows a failed run with the stage the pipeline stored", async () => {
    await requestVariants(user, { masterIdeaId: ideaId });
    const [es] = await drafts();
    await t.db
      .update(schema.contentVariants)
      .set({
        status: "DRAFT",
        slidesJson: [],
        lastError: {
          code: "INVALID_OUTPUT",
          message: "The CRITIC:0 step did not produce a valid answer.",
          details: { stage: "CRITIC:0" },
        },
      })
      .where(eq(schema.contentVariants.id, es ?? ""));
    const [failed] = await getDraftProgress(user, ideaId);
    expect(failed).toMatchObject({ phase: "failed", error: { code: "INVALID_OUTPUT" } });
    expect(states(failed as never)).toMatchObject({ WRITE: "done", CRITIC: "failed" });
  });

  it("ignores a run that began long ago in the header's count", async () => {
    await requestVariants(user, { masterIdeaId: ideaId });
    const [es] = await drafts();
    await t.db
      .update(schema.contentVariants)
      .set({
        status: "GENERATING",
        pipelineState: {
          pipelineRunId: "old",
          stage: "ADAPT",
          startedAt: new Date(clock.now().getTime() - 5 * 60 * MIN).toISOString(),
          completedStages: [],
          runIds: {},
        },
      })
      .where(eq(schema.contentVariants.id, es ?? ""));
    expect(await getActivity(user)).toEqual({ running: 0 });
    // The panel still shows it, as stalled.
    expect((await getDraftProgress(user, ideaId))[0]).toMatchObject({
      phase: "running",
      stalled: true,
    });
  });

  it("learns the usual duration from finished runs: their median, once there are three", async () => {
    const audit = (durationMs: number) => ({
      actorType: "SYSTEM" as const,
      action: "variant.generated",
      entityType: "content_variant",
      data: { durationMs },
    });
    await t.db.insert(schema.auditEvents).values([audit(120_000), audit(300_000)]);
    expect(await usualDraftDurationMs(user)).toBeNull();
    await t.db.insert(schema.auditEvents).values(audit(180_000));
    expect(await usualDraftDurationMs(user)).toBe(180_000);
    await t.db.insert(schema.auditEvents).values(audit(240_000));
    expect(await usualDraftDurationMs(user)).toBe(210_000);
  });

  it("records the duration of a finished run in its audit event", async () => {
    await requestVariants(user, { masterIdeaId: ideaId });
    const rows = await t.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "variant.generated"));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.data).toHaveProperty("durationMs", expect.any(Number));
  });
});
