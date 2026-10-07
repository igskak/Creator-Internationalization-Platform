import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider, EMBEDDING_DIMENSIONS } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInlineJobRunner,
  createServiceContext,
  manualClock,
  type ServiceContext,
} from "../../core";
import { jobHandlers } from "../../job-handlers";
import { createManualIdea, updateIdea } from "./manual";
import { generateIdeas, getIdeasRequestStatus, runGenerateIdeas } from "./request";
import { transitionIdea } from "./transition";

// Integration tests for the idea services (plan 05 §5.6, M2-07). Synthetic content only.

const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});
const rights: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "UNKNOWN",
};
const axis = (i: number) => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[i % EMBEDDING_DIMENSIONS] = 1;
  return v;
};
const NO_SUCH = "00000000-0000-4000-8000-000000000000";

describe("idea services", () => {
  let t: TestDb;
  let ownerId: string;
  let brandId: string;
  let sourceId: string;
  let respond: (call: number) => unknown;
  let llm: ReturnType<typeof createFakeLLMProvider>;
  /** Runs before the model answers: lets a test change the data "while the model works". */
  let whileModelWorks: (() => Promise<void>) | undefined;
  let user: ServiceContext;
  let jobsCtx: ServiceContext;
  let n = 0;
  const clock = manualClock("2026-10-07T12:00:00Z");

  const make = (actor: ServiceContext["actor"], runner?: ServiceContext["jobs"]) =>
    createServiceContext({
      db: t.db,
      logger,
      clock,
      llm: {
        id: llm.id,
        generateStructured: async (request) => {
          await whileModelWorks?.();
          return llm.generateStructured(request);
        },
      },
      embeddings: createFakeEmbeddingProvider(),
      actor,
      ...(runner ? { jobs: runner } : {}),
    });

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [owner] = await t.db.select().from(schema.appUsers);
    ownerId = owner?.id ?? "";
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({ brandId, type: "GUIDE", title: "g", originalLanguage: "ru", rights })
      .returning();
    sourceId = source?.id ?? "";
    whileModelWorks = undefined;
    respond = () => ({ ideas: [] });
    llm = createFakeLLMProvider({ handler: (_r, call) => respond(call) });
    const runner: ReturnType<typeof createInlineJobRunner> = createInlineJobRunner({
      handlers: jobHandlers,
      mode: "await",
      makeContext: (runId) => make({ type: "JOB", jobRunId: runId }, runner),
    });
    user = make({ type: "USER", userId: ownerId, role: "owner" }, runner);
    jobsCtx = make({ type: "JOB", jobRunId: "run-1" }, runner);
    n = 0;
  });
  afterEach(async () => {
    await t.close();
  });

  const addCard = async (over: Partial<typeof schema.knowledgeItems.$inferInsert> = {}) => {
    n += 1;
    const [row] = await t.db
      .insert(schema.knowledgeItems)
      .values({
        brandId,
        title: `Карточка ${n}`,
        category: "GRAINS_RICE_PASTA",
        claim: `Утверждение ${n}`,
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "CHEF_APPROVED",
        approvedVersion: 2,
        approvedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, n)),
        sourceAssetId: sourceId,
        embedding: axis(n),
        embeddingModel: "fake-embedding",
        ...over,
      })
      .returning();
    return row?.id ?? "";
  };
  const addProduct = async (code = "GUIDE", status: "ACTIVE" | "INACTIVE" = "ACTIVE") => {
    const [row] = await t.db
      .insert(schema.products)
      .values({
        brandId,
        code,
        name: `Product ${code}`,
        type: "GUIDE",
        originalLanguage: "ru",
        status,
      })
      .returning();
    return row?.id ?? "";
  };
  const ideaRow = async (id: string) => {
    const [row] = await t.db.select().from(schema.masterIdeas).where(eq(schema.masterIdeas.id, id));
    if (!row) throw new Error("missing idea");
    return row;
  };
  const links = (ideaId: string) =>
    t.db
      .select()
      .from(schema.masterIdeaKnowledge)
      .where(eq(schema.masterIdeaKnowledge.masterIdeaId, ideaId));
  const audits = async () =>
    (await t.db.select().from(schema.auditEvents).orderBy(schema.auditEvents.id)).map(
      (e) => e.action,
    );

  const manual = (cardId: string, over: Record<string, unknown> = {}) =>
    createManualIdea(user, {
      topic: "Do not rinse risotto rice",
      category: "GRAINS_RICE_PASTA",
      angle: "COMMON_MISTAKE",
      coreMessage: "Rinsing washes away the starch that makes risotto creamy.",
      knowledge: [{ id: cardId, role: "PRIMARY" }],
      ...over,
    });

  describe("createManualIdea", () => {
    it("stores a PROPOSED MANUAL idea linked to the approved version of each card", async () => {
      const [a, b] = [
        await addCard({ approvedVersion: 3 }),
        await addCard({ approvedVersion: 5 }),
      ] as [string, string];
      const idea = await manual(a, {
        knowledge: [
          { id: a, role: "PRIMARY" },
          { id: b, role: "SUPPORTING" },
        ],
      });
      expect(idea).toMatchObject({
        status: "PROPOSED",
        origin: "MANUAL",
        recommendedFormat: "CAROUSEL",
        commercialIntent: "NONE",
        productId: null,
        createdBy: ownerId,
        brandId,
      });
      expect(
        (await links(idea.id)).map((l) => [l.knowledgeItemId, l.knowledgeVersion, l.role]).sort(),
      ).toEqual(
        [
          [a, 3, "PRIMARY"],
          [b, 5, "SUPPORTING"],
        ].sort(),
      );
      expect(await audits()).toEqual(["idea.created"]);
    });

    it("refuses a card that is not approved, listing it, and stores nothing", async () => {
      const card = await addCard({ reviewStatus: "NEEDS_REVIEW" });
      const error = await manual(card).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidStateError);
      expect((error as InvalidStateError).details).toEqual({
        cards: [{ id: card, title: expect.any(String), status: "NEEDS_REVIEW" }],
      });
      expect(await t.db.select().from(schema.masterIdeas)).toEqual([]);
    });

    it("validates the cards: one primary, no repeats, they must exist", async () => {
      const card = await addCard();
      await expect(
        manual(card, { knowledge: [{ id: card, role: "SUPPORTING" }] }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        manual(card, {
          knowledge: [
            { id: card, role: "PRIMARY" },
            { id: card, role: "SUPPORTING" },
          ],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        manual(card, { knowledge: [{ id: NO_SUCH, role: "PRIMARY" }] }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(manual(card, { knowledge: [] })).rejects.toBeInstanceOf(ValidationError);
    });

    it("validates taxonomy codes and the product with its intent", async () => {
      const card = await addCard();
      await expect(manual(card, { category: "NOT_A_CATEGORY" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(manual(card, { angle: "GRAINS_RICE_PASTA" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(manual(card, { commercialIntent: "LEAD_MAGNET" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      const product = await addProduct();
      await expect(manual(card, { productId: product })).rejects.toBeInstanceOf(ValidationError);
      await expect(
        manual(card, { productId: NO_SUCH, commercialIntent: "LEAD_MAGNET" }),
      ).rejects.toBeInstanceOf(ValidationError);
      const retired = await addProduct("OLD", "INACTIVE");
      await expect(
        manual(card, { productId: retired, commercialIntent: "LEAD_MAGNET" }),
      ).rejects.toBeInstanceOf(ValidationError);
      const idea = await manual(card, { productId: product, commercialIntent: "LEAD_MAGNET" });
      expect(idea).toMatchObject({ productId: product, commercialIntent: "LEAD_MAGNET" });
    });

    it("trims text and rejects an empty topic", async () => {
      const card = await addCard();
      expect((await manual(card, { topic: "  Rice  " })).topic).toBe("Rice");
      await expect(manual(card, { topic: "   " })).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("updateIdea", () => {
    it("changes fields and records which ones, keeping the links", async () => {
      const card = await addCard();
      const idea = await manual(card);
      const updated = await updateIdea(user, {
        id: idea.id,
        patch: { topic: "New topic", coreMessage: "New message." },
      });
      expect(updated).toMatchObject({ topic: "New topic", coreMessage: "New message." });
      expect(await links(idea.id)).toHaveLength(1);
      const [event] = (await t.db.select().from(schema.auditEvents)).filter(
        (e) => e.action === "idea.updated",
      );
      expect(event?.data).toEqual({ fields: ["topic", "coreMessage"] });
    });

    it("replaces the cards with their current approved versions", async () => {
      const [a, b] = [await addCard(), await addCard({ approvedVersion: 7 })] as [string, string];
      const idea = await manual(a);
      await updateIdea(user, { id: idea.id, patch: { knowledge: [{ id: b, role: "PRIMARY" }] } });
      expect((await links(idea.id)).map((l) => [l.knowledgeItemId, l.knowledgeVersion])).toEqual([
        [b, 7],
      ]);
      await expect(
        updateIdea(user, {
          id: idea.id,
          patch: {
            knowledge: [{ id: await addCard({ reviewStatus: "ARCHIVED" }), role: "PRIMARY" }],
          },
        }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      expect(await links(idea.id)).toHaveLength(1);
    });

    it("checks the merged product and intent", async () => {
      const idea = await manual(await addCard());
      await expect(
        updateIdea(user, { id: idea.id, patch: { commercialIntent: "NURTURE" } }),
      ).rejects.toBeInstanceOf(ValidationError);
      const product = await addProduct();
      const sold = await updateIdea(user, {
        id: idea.id,
        patch: { productId: product, commercialIntent: "PRODUCT_SALE" },
      });
      expect(sold.productId).toBe(product);
      await expect(
        updateIdea(user, { id: idea.id, patch: { productId: null } }),
      ).rejects.toBeInstanceOf(ValidationError);
      const cleared = await updateIdea(user, {
        id: idea.id,
        patch: { productId: null, commercialIntent: "NONE" },
      });
      expect(cleared.productId).toBeNull();
    });

    it("works on PROPOSED and ACCEPTED ideas only, and not with an empty or unknown patch", async () => {
      const idea = await manual(await addCard());
      await expect(updateIdea(user, { id: idea.id, patch: {} })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(updateIdea(user, { id: NO_SUCH, patch: { topic: "x" } })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await transitionIdea(user, { id: idea.id, to: "ACCEPTED" });
      await updateIdea(user, { id: idea.id, patch: { topic: "still editable" } });
      await transitionIdea(user, { id: idea.id, to: "ARCHIVED" });
      await expect(
        updateIdea(user, { id: idea.id, patch: { topic: "no" } }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it("is refused once a variant is past DRAFT, allowed while variants are drafts or rejected", async () => {
      const idea = await manual(await addCard());
      await transitionIdea(user, { id: idea.id, to: "ACCEPTED" });
      const [market] = await t.db.select().from(schema.markets);
      const variant = async (status: "DRAFT" | "REJECTED" | "READY_FOR_REVIEW") =>
        t.db
          .insert(schema.contentVariants)
          .values({
            masterIdeaId: idea.id,
            marketId: market?.id ?? "",
            status,
            format: status === "REJECTED" ? "REEL" : "CAROUSEL",
          })
          .returning();
      await variant("DRAFT");
      await variant("REJECTED");
      await updateIdea(user, { id: idea.id, patch: { topic: "ok" } });
      await t.db
        .update(schema.contentVariants)
        .set({ status: "READY_FOR_REVIEW" })
        .where(eq(schema.contentVariants.masterIdeaId, idea.id));
      await expect(
        updateIdea(user, { id: idea.id, patch: { topic: "no" } }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });
  });

  describe("transitionIdea", () => {
    it("accepts a PROPOSED idea whose cards are still approved, with an audit event", async () => {
      const idea = await manual(await addCard());
      const accepted = await transitionIdea(user, { id: idea.id, to: "ACCEPTED" });
      expect(accepted.status).toBe("ACCEPTED");
      expect(await audits()).toEqual(["idea.created", "idea.accepted"]);
    });

    it("refuses to accept when a linked card is no longer approved", async () => {
      const card = await addCard();
      const idea = await manual(card);
      await t.db
        .update(schema.knowledgeItems)
        .set({ reviewStatus: "NEEDS_REVIEW" })
        .where(eq(schema.knowledgeItems.id, card));
      const error = await transitionIdea(user, { id: idea.id, to: "ACCEPTED" }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(InvalidStateError);
      expect((error as InvalidStateError).details).toEqual({
        cards: [{ id: card, title: expect.any(String), status: "NEEDS_REVIEW" }],
      });
      expect((await ideaRow(idea.id)).status).toBe("PROPOSED");
    });

    it("rejects with a reason, keeps it, and restores to PROPOSED clearing it", async () => {
      const idea = await manual(await addCard());
      await expect(transitionIdea(user, { id: idea.id, to: "REJECTED" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        transitionIdea(user, { id: idea.id, to: "REJECTED", reason: "  " }),
      ).rejects.toBeInstanceOf(ValidationError);
      const rejected = await transitionIdea(user, {
        id: idea.id,
        to: "REJECTED",
        reason: "Too basic",
      });
      expect(rejected).toMatchObject({ status: "REJECTED", rejectedReason: "Too basic" });
      const archived = await transitionIdea(user, { id: idea.id, to: "ARCHIVED" });
      expect(archived).toMatchObject({ status: "ARCHIVED", rejectedReason: "Too basic" });
      const restored = await transitionIdea(user, { id: idea.id, to: "PROPOSED" });
      expect(restored).toMatchObject({ status: "PROPOSED", rejectedReason: null });
    });

    it("follows the state table", async () => {
      const idea = await manual(await addCard());
      await expect(transitionIdea(user, { id: idea.id, to: "PROPOSED" })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      await transitionIdea(user, { id: idea.id, to: "ACCEPTED" });
      await expect(
        transitionIdea(user, { id: idea.id, to: "REJECTED", reason: "x" }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(transitionIdea(user, { id: idea.id, to: "ACCEPTED" })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      await expect(transitionIdea(user, { id: NO_SUCH, to: "ACCEPTED" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("does not archive under an approved, scheduled or publishing variant", async () => {
      const idea = await manual(await addCard());
      await transitionIdea(user, { id: idea.id, to: "ACCEPTED" });
      const [market] = await t.db.select().from(schema.markets);
      await t.db
        .insert(schema.contentVariants)
        .values({ masterIdeaId: idea.id, marketId: market?.id ?? "", status: "APPROVED" });
      const error = await transitionIdea(user, { id: idea.id, to: "ARCHIVED" }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(InvalidStateError);
      expect((error as InvalidStateError).details).toEqual({
        variants: [{ id: expect.any(String), status: "APPROVED" }],
      });
      await t.db
        .update(schema.contentVariants)
        .set({ status: "READY_FOR_REVIEW" })
        .where(eq(schema.contentVariants.masterIdeaId, idea.id));
      expect((await transitionIdea(user, { id: idea.id, to: "ARCHIVED" })).status).toBe("ARCHIVED");
    });
  });

  describe("generateIdeas and the J4 job", () => {
    const draft = (cardId: string, over: Record<string, unknown> = {}) => ({
      topic: "Do not rinse risotto rice",
      category: "GRAINS_RICE_PASTA",
      angle: "COMMON_MISTAKE",
      coreMessage: "Rinsing risotto rice washes away the starch that makes it creamy.",
      primaryKnowledgeIds: [cardId],
      supportingKnowledgeIds: [],
      recommendedFormat: "CAROUSEL",
      commercialIntent: "NONE",
      productCode: null,
      rationale: "Card says surface starch makes risotto creamy.",
      whyNow: "Grains are uncovered.",
      differsFromRecent: "New topic.",
      ...over,
    });

    it("queues the job, runs it, and stores PROPOSED ideas with links to the approved versions", async () => {
      const [a, b] = [
        await addCard({ approvedVersion: 4 }),
        await addCard({ approvedVersion: 6 }),
      ] as [string, string];
      const product = await addProduct("RICE-GUIDE");
      const [en] = await t.db.select().from(schema.markets).where(eq(schema.markets.code, "en"));
      await t.db.insert(schema.offers).values({
        marketId: en?.id ?? "",
        productId: product,
        name: "Free chapter",
        type: "LEAD_MAGNET",
        currency: "USD",
        status: "ACTIVE",
        priority: 5,
      });
      respond = () => ({
        ideas: [
          draft(a, { commercialIntent: "LEAD_MAGNET", productCode: "RICE-GUIDE" }),
          draft(b, {
            topic: "Water ratio",
            coreMessage: "Two parts water to one part rice.",
            supportingKnowledgeIds: [a],
          }),
        ],
      });
      const { jobRunId, requestId } = await generateIdeas(user, {
        count: 3,
        note: "Focus on rice",
      });
      expect(jobRunId).toMatch(/^inline_/);

      const status = await getIdeasRequestStatus(user, requestId);
      expect(status).toMatchObject({
        state: "DONE",
        outcome: { outcome: "OK", dropped: 0, skipped: 0 },
      });
      const ideas = await t.db.select().from(schema.masterIdeas).orderBy(schema.masterIdeas.topic);
      expect(
        ideas.map((i) => [i.topic, i.status, i.origin, i.productId, i.commercialIntent]),
      ).toEqual([
        ["Do not rinse risotto rice", "PROPOSED", "AI_GENERATED", product, "LEAD_MAGNET"],
        ["Water ratio", "PROPOSED", "AI_GENERATED", null, "NONE"],
      ]);
      expect(ideas[0]).toMatchObject({
        evidenceSummary: expect.stringContaining("surface starch"),
        rationale: expect.stringContaining("Why now: Grains are uncovered."),
        generationRunId: expect.any(String),
      });
      const water = ideas[1];
      expect(
        (await links(water?.id ?? ""))
          .map((l) => [l.knowledgeItemId, l.knowledgeVersion, l.role])
          .sort(),
      ).toEqual(
        [
          [b, 6, "PRIMARY"],
          [a, 4, "SUPPORTING"],
        ].sort(),
      );
      expect(await audits()).toEqual([
        "ideas.requested",
        "idea.created",
        "idea.created",
        "ideas.generated",
      ]);
      const runs = await t.db.select().from(schema.generationRuns);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ stage: "IDEA_GENERATION", status: "SUCCEEDED" });
      expect(JSON.stringify(llm.calls[0]?.messages)).toContain("Note: Focus on rice");
    });

    it("reports PENDING before the job ran and refuses an unknown request id", async () => {
      await addCard();
      const requested = await make(
        { type: "USER", userId: ownerId, role: "owner" },
        {
          trigger: async () => ({ runId: "later" }),
          triggerAndWaitAll: async () => [],
        },
      );
      const { requestId } = await generateIdeas(requested, { count: 1 });
      expect(await getIdeasRequestStatus(user, requestId)).toEqual({ state: "PENDING" });
      await expect(getIdeasRequestStatus(user, NO_SUCH)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("is idempotent: the same request id returns the stored outcome and adds nothing", async () => {
      const a = await addCard();
      respond = () => ({ ideas: [draft(a)] });
      const { requestId } = await generateIdeas(user, { count: 1 });
      const payload = { requestId, count: 1 };
      const again = await runGenerateIdeas(jobsCtx, payload);
      expect(again).toMatchObject({ requestId, outcome: "OK" });
      expect(await t.db.select().from(schema.masterIdeas)).toHaveLength(1);
      expect(llm.calls).toHaveLength(1);
      expect((await audits()).filter((x) => x === "ideas.generated")).toHaveLength(1);
    });

    it("records a FAILED outcome when there are no approved cards", async () => {
      await addCard({ reviewStatus: "NEEDS_REVIEW" });
      const { requestId } = await generateIdeas(user, { count: 2 });
      const status = await getIdeasRequestStatus(user, requestId);
      expect(status).toMatchObject({
        state: "FAILED",
        outcome: { outcome: "FAILED", created: [], reason: expect.stringContaining("approved") },
      });
      expect(llm.calls).toHaveLength(0);
    });

    it("records a FAILED outcome when the model's answer stays invalid after the repair", async () => {
      const a = await addCard();
      respond = () => ({ ideas: [draft(a, { primaryKnowledgeIds: ["nope"] })] });
      const { requestId } = await generateIdeas(user, { count: 1 });
      const status = await getIdeasRequestStatus(user, requestId);
      expect(status).toMatchObject({
        state: "FAILED",
        outcome: {
          reason: expect.stringContaining("failed the checks"),
          runIds: expect.any(Array),
        },
      });
      expect(await t.db.select().from(schema.masterIdeas)).toEqual([]);
    });

    it("skips an idea whose card was edited while the model worked", async () => {
      const [a, b] = [await addCard(), await addCard()] as [string, string];
      whileModelWorks = async () => {
        // The chef sends card `a` back to review while the model is answering.
        await t.db
          .update(schema.knowledgeItems)
          .set({ reviewStatus: "NEEDS_REVIEW" })
          .where(eq(schema.knowledgeItems.id, a));
      };
      respond = () => ({
        ideas: [
          draft(a),
          draft(b, { topic: "Other", coreMessage: "A different claim about water." }),
        ],
      });
      const { requestId } = await generateIdeas(user, { count: 2 });
      const status = await getIdeasRequestStatus(user, requestId);
      expect(status).toMatchObject({ state: "DONE" });
      const ideas = await t.db.select().from(schema.masterIdeas);
      expect(ideas.map((i) => i.topic)).toEqual(["Other"]);
      expect(status.state === "DONE" && status.outcome.skipped).toBe(1);
    });

    it("validates the focus before queueing anything", async () => {
      await addCard();
      await expect(generateIdeas(user, { count: 0 })).rejects.toBeInstanceOf(ValidationError);
      await expect(generateIdeas(user, { count: 11 })).rejects.toBeInstanceOf(ValidationError);
      await expect(
        generateIdeas(user, { count: 2, focus: { categories: ["NOPE"] } }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        generateIdeas(user, { count: 2, focus: { angles: ["NOPE"] } }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        generateIdeas(user, { count: 2, focus: { productId: NO_SUCH } }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(await audits()).toEqual([]);
      expect(llm.calls).toHaveLength(0);
    });

    it("turns the focus into prompt text and narrows the card pool by category", async () => {
      const rice = await addCard();
      await addCard({ category: "EGGS" });
      const product = await addProduct("RICE-GUIDE");
      respond = () => ({ ideas: [draft(rice)] });
      await generateIdeas(user, {
        count: 1,
        focus: {
          categories: ["GRAINS_RICE_PASTA"],
          angles: ["COMMON_MISTAKE"],
          productId: product,
          commercialIntent: "LEAD_MAGNET",
        },
      });
      const text = JSON.stringify(llm.calls[0]?.messages);
      expect(text).toContain(
        "Categories: GRAINS_RICE_PASTA; Angles: COMMON_MISTAKE; Feature the product RICE-GUIDE (Product RICE-GUIDE); Commercial intent: LEAD_MAGNET",
      );
      expect(text).toContain(`id=\\"${rice}\\"`);
      expect((text.match(/<card id=/g) ?? []).length).toBe(1);
    });
  });
});
