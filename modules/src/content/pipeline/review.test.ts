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
  manualClock,
  type ServiceContext,
} from "../../core";
import { jobHandlers } from "../../job-handlers";
import { requestIdeaRegeneration, requestVariants } from "./request";
import { getReviewBundle } from "./review";
import {
  marketOfRequest,
  scriptedBrief,
  scriptedDraft,
  scriptedReview,
  seedAcceptedIdea,
  textOfRequest,
} from "./scripted-model";

// The read side of the review screen (M2-15) and "Regenerate all". Synthetic content only.

const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

describe("review bundle and regenerate all", () => {
  let t: TestDb;
  let user: ServiceContext;
  let cards: [string, string];
  let ideaId: string;
  let llm: ReturnType<typeof createFakeLLMProvider>;
  const clock = manualClock("2026-10-08T12:00:00Z");

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
          return scriptedDraft(
            market,
            cards,
            textOfRequest(request).includes("<rewrite>") ? "redone" : "",
          );
        }
        return scriptedReview({
          issues:
            market === "en"
              ? [
                  {
                    severity: "MINOR",
                    category: "LOCALIZATION",
                    fieldPath: "slides.1.slots.body",
                    explanation: "Note.",
                    suggestedFix: "",
                  },
                ]
              : [],
        });
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
      // The browser render (J8) is tested on its own; here it would start Chromium.
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

  it("shows an idea without drafts as an empty list", async () => {
    const bundle = await getReviewBundle(user, ideaId);
    expect(bundle.variants).toEqual([]);
    expect(bundle.idea.cards.map((c) => c.id).sort()).toEqual([...cards].sort());
    expect(bundle.costUsd).toBeNull();
    await expect(getReviewBundle(user, crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns every market's draft in market order with its critic report, flags and comparison", async () => {
    await requestVariants(user, { masterIdeaId: ideaId });
    const bundle = await getReviewBundle(user, ideaId);
    expect(bundle.variants.map((v) => v.marketCode)).toEqual(["es-ES", "en"]);
    const [es, en] = bundle.variants;
    expect(es).toMatchObject({
      marketName: "Spain",
      status: "READY_FOR_REVIEW",
      hasContent: true,
      hookType: "MISTAKE_CALLOUT",
      generationVersion: "p1.1.0",
      lastError: null,
      critic: { verdict: "PASS", iteration: 0 },
      differentiation: { verdict: "OK" },
    });
    expect(es?.qualityScore).toBe(4.38);
    expect(es?.slides).toHaveLength(5);
    // Slots come in the order of the template (mistake before correct), not in jsonb's key order.
    expect(Object.keys(es?.slides[1]?.slots ?? {})).toEqual([
      "mistakeTitle",
      "mistakeText",
      "correctTitle",
      "correctText",
    ]);
    expect(es?.cta).toMatchObject({ type: "SAVE" });
    expect(es?.brief?.hookType).toBe("MISTAKE_CALLOUT");
    expect(en?.critic?.issues).toEqual([
      expect.objectContaining({
        severity: "MINOR",
        fieldPath: expect.stringMatching(/^slides\.[\w-]+\.slots\.body$/),
      }),
    ]);
    expect(en?.slides).toHaveLength(6);
  });

  it("leaves out rejected variants and shows a failed or queued one without content", async () => {
    await requestVariants(user, { masterIdeaId: ideaId });
    const [first, second] = await t.db
      .select()
      .from(schema.contentVariants)
      .orderBy(schema.contentVariants.createdAt);
    await t.db
      .update(schema.contentVariants)
      .set({ status: "REJECTED" })
      .where(eq(schema.contentVariants.id, first?.id ?? ""));
    await t.db
      .update(schema.contentVariants)
      .set({
        status: "DRAFT",
        slidesJson: [],
        hook: null,
        flags: ["GENERATION_FAILED"],
        lastError: { code: "INVALID_OUTPUT", message: "Did not work." },
      })
      .where(eq(schema.contentVariants.id, second?.id ?? ""));
    const bundle = await getReviewBundle(user, ideaId);
    expect(bundle.variants).toHaveLength(1);
    expect(bundle.variants[0]).toMatchObject({
      status: "DRAFT",
      hasContent: false,
      flags: ["GENERATION_FAILED"],
      lastError: { code: "INVALID_OUTPUT", message: "Did not work." },
    });
  });

  describe("requestIdeaRegeneration (Regenerate all)", () => {
    it("redoes every market in one run, with the instruction", async () => {
      await requestVariants(user, { masterIdeaId: ideaId });
      const before = llm.calls.length;
      const result = await requestIdeaRegeneration(user, {
        masterIdeaId: ideaId,
        reasonCode: "WEAK_HOOK",
        instruction: "Open with a question.",
      });
      expect(result.variantIds).toHaveLength(2);
      const prompts = llm.calls.slice(before).map((r) => r.meta.promptId);
      expect(prompts.filter((p) => p === "market-adapter")).toHaveLength(2);
      expect(prompts.filter((p) => p === "content-writer")).toHaveLength(2);
      const bundle = await getReviewBundle(user, ideaId);
      expect(bundle.variants.map((v) => v.hook)).toEqual(["Texto hook redone", "Copy hook redone"]);
      const requested = (await t.db.select().from(schema.auditEvents)).filter(
        (a) => a.action === "variants.regeneration_requested",
      );
      expect(requested).toEqual([
        expect.objectContaining({
          entityId: ideaId,
          data: expect.objectContaining({ reasonCode: "WEAK_HOOK" }),
        }),
      ]);
    });

    it("refuses with no drafts, a bad reason, a draft past review, or an idea that is not accepted", async () => {
      const ask = (patch: object = {}) =>
        requestIdeaRegeneration(user, { masterIdeaId: ideaId, reasonCode: "WEAK_HOOK", ...patch });
      await expect(ask()).rejects.toThrow("There are no drafts to regenerate.");
      await requestVariants(user, { masterIdeaId: ideaId });
      await expect(ask({ reasonCode: "NOPE" })).rejects.toBeInstanceOf(ValidationError);
      await expect(ask({ masterIdeaId: crypto.randomUUID() })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      const [first] = await t.db.select().from(schema.contentVariants);
      await t.db
        .update(schema.contentVariants)
        .set({ status: "APPROVED" })
        .where(eq(schema.contentVariants.id, first?.id ?? ""));
      await expect(ask()).rejects.toBeInstanceOf(InvalidStateError);
      await t.db
        .update(schema.contentVariants)
        .set({ status: "READY_FOR_REVIEW" })
        .where(eq(schema.contentVariants.id, first?.id ?? ""));
      await t.db.update(schema.masterIdeas).set({ status: "ARCHIVED" });
      await expect(ask()).rejects.toBeInstanceOf(InvalidStateError);
    });
  });
});
