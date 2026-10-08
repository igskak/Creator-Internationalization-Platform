import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInlineJobRunner,
  createServiceContext,
  getStatuses,
  manualClock,
  type ServiceContext,
} from "../../core";
import { jobHandlers } from "../../job-handlers";
import { requestVariantRegeneration, requestVariants } from "./request";
import {
  marketOfRequest,
  scriptedBrief,
  scriptedDraft,
  scriptedReview,
  seedAcceptedIdea,
  textOfRequest,
} from "./scripted-model";

// The actions of M2-14 from the call to READY_FOR_REVIEW, through the inline job runner (J5), with
// a scripted model. Synthetic content only.

const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

describe("generateVariants and regenerateVariant actions", () => {
  let t: TestDb;
  let user: ServiceContext;
  let cards: [string, string];
  let ideaId: string;
  let llm: ReturnType<typeof createFakeLLMProvider>;
  let mode: "await" | "queue";
  const queued: { name: string; payload: unknown; key?: string }[] = [];
  const clock = manualClock("2026-10-08T12:00:00Z");

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

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const seeded = await seedAcceptedIdea(t.db);
    cards = [seeded.card1, seeded.card2];
    ideaId = seeded.ideaId;
    const [owner] = await t.db.select().from(schema.appUsers);
    llm = createFakeLLMProvider({
      handler: (request) => {
        const market = marketOfRequest(request);
        if (request.meta.promptId === "market-adapter") return scriptedBrief(market, cards);
        if (request.meta.promptId === "content-writer") {
          // A rewrite or an instruction changes the texts, so a regeneration is visible.
          const text = textOfRequest(request);
          return scriptedDraft(market, cards, text.includes("<rewrite>") ? "redone" : "");
        }
        return scriptedReview();
      },
    });
    mode = "await";
    queued.length = 0;
    const runner: ServiceContext["jobs"] = createInlineJobRunner({
      handlers: jobHandlers,
      mode: "await",
      makeContext: (runId) => make({ type: "JOB", jobRunId: runId }, runner),
    });
    const recording: ServiceContext["jobs"] = {
      ...runner,
      trigger: async (name, payload, options) => {
        queued.push({
          name,
          payload,
          ...(options?.idempotencyKey ? { key: options.idempotencyKey } : {}),
        });
        return mode === "await" ? runner.trigger(name, payload, options) : { runId: "queued-run" };
      },
    };
    user = make({ type: "USER", userId: owner?.id ?? "", role: "owner" }, recording);
  });
  afterEach(async () => {
    await t.close();
  });

  const variants = () =>
    t.db.select().from(schema.contentVariants).orderBy(schema.contentVariants.createdAt);
  const marketId = async (code: string) =>
    (await t.db.select().from(schema.markets).where(eq(schema.markets.code, code)))[0]?.id ?? "";

  it("goes from the action to READY_FOR_REVIEW for every active market", async () => {
    const result = await requestVariants(user, { masterIdeaId: ideaId });
    expect(result.variantIds).toHaveLength(2);
    expect(queued).toEqual([
      {
        name: "generate-content",
        payload: {
          masterIdeaId: ideaId,
          variantIds: result.variantIds,
          pipelineRunId: result.pipelineRunId,
        },
        key: `gen:${result.pipelineRunId}`,
      },
    ]);
    const rows = await variants();
    expect(rows.map((v) => v.status)).toEqual(["READY_FOR_REVIEW", "READY_FOR_REVIEW"]);
    expect(rows.every((v) => v.criticVerdict === "PASS" && v.slidesJson.length >= 5)).toBe(true);
    const actions = (await t.db.select().from(schema.auditEvents)).map((a) => a.action);
    expect(actions).toContain("variants.requested");
    expect(actions.filter((a) => a === "variant.generated")).toHaveLength(2);
  });

  it("makes variants only for the markets asked for", async () => {
    const es = await marketId("es-ES");
    const result = await requestVariants(user, { masterIdeaId: ideaId, marketIds: [es] });
    expect(result.variantIds).toHaveLength(1);
    expect((await variants())[0]?.marketId).toBe(es);
  });

  it("queues without running when the job is not inline, leaving DRAFT variants", async () => {
    mode = "queue";
    const result = await requestVariants(user, { masterIdeaId: ideaId });
    expect(result.jobRunId).toBe("queued-run");
    expect((await variants()).map((v) => v.status)).toEqual(["DRAFT", "DRAFT"]);
    expect(llm.calls).toHaveLength(0);
  });

  it("retries the DRAFT variant of a failed run instead of making a second one", async () => {
    mode = "queue";
    const first = await requestVariants(user, { masterIdeaId: ideaId });
    const second = await requestVariants(user, { masterIdeaId: ideaId });
    expect(second.variantIds.sort()).toEqual(first.variantIds.sort());
    expect(await variants()).toHaveLength(2);
    expect(second.pipelineRunId).not.toBe(first.pipelineRunId);
  });

  it("refuses an idea that is not ACCEPTED, unknown input and markets that already have drafts", async () => {
    await t.db.update(schema.masterIdeas).set({ status: "PROPOSED" });
    await expect(requestVariants(user, { masterIdeaId: ideaId })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await t.db.update(schema.masterIdeas).set({ status: "ACCEPTED" });
    await expect(
      requestVariants(user, { masterIdeaId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestVariants(user, { masterIdeaId: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      requestVariants(user, { masterIdeaId: ideaId, marketIds: [crypto.randomUUID()] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const fr = await marketId("fr-FR");
    await expect(
      requestVariants(user, { masterIdeaId: ideaId, marketIds: [fr] }),
    ).rejects.toBeInstanceOf(ValidationError); // inactive market

    await requestVariants(user, { masterIdeaId: ideaId });
    await expect(requestVariants(user, { masterIdeaId: ideaId })).rejects.toMatchObject({
      message: expect.stringContaining("Regenerate"),
    });
  });

  describe("regenerateVariant", () => {
    it("redoes one market with the person's instruction and leaves the other alone", async () => {
      await requestVariants(user, { masterIdeaId: ideaId });
      const [first, second] = await variants();
      const before = llm.calls.length;
      const result = await requestVariantRegeneration(user, {
        variantId: first?.id ?? "",
        instruction: "Open with a question.",
        reasonCode: "WEAK_HOOK",
      });
      expect(result.jobRunId).toBeTruthy();
      expect(queued.at(-1)).toMatchObject({
        name: "generate-content",
        payload: { variantIds: [first?.id], instruction: "Open with a question." },
        key: `gen:${result.pipelineRunId}`,
      });
      const [redone, untouched] = await variants();
      expect(redone).toMatchObject({ status: "READY_FOR_REVIEW" });
      expect(redone?.hook).toContain("redone");
      expect(untouched?.hook).toBe(second?.hook);
      const prompts = llm.calls.slice(before).map((r) => r.meta.promptId);
      expect(prompts.filter((p) => p === "content-writer")).toHaveLength(1);
      expect(
        (await t.db.select().from(schema.auditEvents)).filter(
          (a) => a.action === "variant.regeneration_requested",
        ),
      ).toEqual([
        expect.objectContaining({
          entityId: first?.id,
          data: expect.objectContaining({ reasonCode: "WEAK_HOOK" }),
        }),
      ]);
    });

    it("checks the variant, its status, the reason code and the idea", async () => {
      await requestVariants(user, { masterIdeaId: ideaId });
      const [variant] = await variants();
      const id = variant?.id ?? "";
      const ask = (patch: object = {}) =>
        requestVariantRegeneration(user, { variantId: id, reasonCode: "WEAK_HOOK", ...patch });
      await expect(ask({ variantId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
      await expect(ask({ reasonCode: "NOT_A_REASON" })).rejects.toBeInstanceOf(ValidationError);
      await expect(ask({ instruction: "x".repeat(501) })).rejects.toBeInstanceOf(ValidationError);
      for (const status of ["APPROVED", "SCHEDULED", "GENERATING", "REJECTED"] as const) {
        await t.db
          .update(schema.contentVariants)
          .set({ status })
          .where(eq(schema.contentVariants.id, id));
        await expect(ask()).rejects.toBeInstanceOf(InvalidStateError);
      }
      await t.db
        .update(schema.contentVariants)
        .set({ status: "CHANGES_REQUESTED" })
        .where(eq(schema.contentVariants.id, id));
      await t.db.update(schema.masterIdeas).set({ status: "ARCHIVED" });
      await expect(ask()).rejects.toBeInstanceOf(InvalidStateError);
    });
  });

  describe("getStatuses for variants", () => {
    it("reports status, flags, error and the running stage; unknown ids are absent", async () => {
      mode = "queue";
      const { variantIds } = await requestVariants(user, { masterIdeaId: ideaId });
      const [a, b] = variantIds as [string, string];
      await t.db
        .update(schema.contentVariants)
        .set({
          status: "GENERATING",
          pipelineState: {
            pipelineRunId: "r",
            stage: "WRITE:0",
            startedAt: "x",
            completedStages: [],
            runIds: {},
          },
        })
        .where(eq(schema.contentVariants.id, a));
      await t.db
        .update(schema.contentVariants)
        .set({
          flags: ["GENERATION_FAILED"],
          lastError: {
            code: "INVALID_OUTPUT",
            message: "The WRITE:0 step did not produce a valid answer.",
          },
        })
        .where(eq(schema.contentVariants.id, b));
      const unknown = crypto.randomUUID();
      const statuses = await getStatuses(user, { variantIds: [a, b, unknown] });
      expect(statuses[a]).toEqual({ status: "GENERATING", stage: "WRITE:0" });
      expect(statuses[b]).toEqual({
        status: "DRAFT",
        flags: ["GENERATION_FAILED"],
        error: "The WRITE:0 step did not produce a valid answer.",
      });
      expect(statuses[unknown]).toBeUndefined();
    });
  });
});
