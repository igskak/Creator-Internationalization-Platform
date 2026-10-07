import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider, EMBEDDING_DIMENSIONS } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import type { ideaGenerator } from "@rc/prompts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, manualClock, type ServiceContext } from "../../core";
import { buildIdeaContext } from "./context";
import { generateIdeaDrafts } from "./generate";
import { dropNearDuplicates, validateIdeaOutput } from "./validate";

type Idea = ideaGenerator.IdeaDraft;

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
const DAY = 24 * 60 * 60 * 1000;
const axis = (i: number) => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[i % EMBEDDING_DIMENSIONS] = 1;
  return v;
};

const idea = (over: Partial<Idea> = {}): Idea => ({
  topic: "Do not rinse risotto rice",
  category: "GRAINS_RICE_PASTA",
  angle: "COMMON_MISTAKE",
  coreMessage: "Rinsing risotto rice washes away the starch that makes it creamy.",
  primaryKnowledgeIds: ["c1"],
  supportingKnowledgeIds: [],
  recommendedFormat: "CAROUSEL",
  commercialIntent: "NONE",
  productCode: null,
  rationale: "Card c1.",
  whyNow: "Not covered recently.",
  differsFromRecent: "New topic.",
  ...over,
});

describe("validateIdeaOutput", () => {
  const context = {
    cardIds: new Set(["c1", "c2", "c3"]),
    productCodes: new Set(["GUIDE"]),
    count: 2,
  };
  const codes = (ideas: Idea[]) => validateIdeaOutput({ ideas }, context).map((i) => i.code);

  it("passes a good batch", () => {
    expect(
      validateIdeaOutput(
        {
          ideas: [
            idea(),
            idea({
              topic: "Water ratio",
              primaryKnowledgeIds: ["c2"],
              supportingKnowledgeIds: ["c3"],
              commercialIntent: "LEAD_MAGNET",
              productCode: "GUIDE",
            }),
          ],
        },
        context,
      ),
    ).toEqual([]);
  });

  it("blocks too many ideas, a missing primary card, unknown, repeated and doubly-used cards", () => {
    expect(
      codes([idea(), idea({ primaryKnowledgeIds: ["c2"] }), idea({ primaryKnowledgeIds: ["c3"] })]),
    ).toEqual(["TOO_MANY_IDEAS"]);
    expect(codes([idea({ primaryKnowledgeIds: [] })])).toEqual(["PRIMARY_MISSING"]);
    expect(codes([idea({ primaryKnowledgeIds: ["c9"] })])).toEqual(["CARD_NOT_IN_POOL"]);
    expect(codes([idea({ supportingKnowledgeIds: ["c2", "c2"] })])).toEqual(["CARD_REPEATED"]);
    expect(codes([idea({ supportingKnowledgeIds: ["c1"] })])).toEqual(["CARD_IN_BOTH_ROLES"]);
  });

  it("checks product and intent together", () => {
    expect(codes([idea({ productCode: "OTHER", commercialIntent: "PRODUCT_SALE" })])).toEqual([
      "PRODUCT_UNKNOWN",
    ]);
    expect(codes([idea({ commercialIntent: "LEAD_MAGNET" })])).toEqual(["INTENT_WITHOUT_PRODUCT"]);
    expect(codes([idea({ productCode: "GUIDE" })])).toEqual(["PRODUCT_WITHOUT_INTENT"]);
  });

  it("blocks empty text and notes a reused primary card without blocking", () => {
    expect(codes([idea({ topic: " " })])).toEqual(["IDEA_TEXT_EMPTY"]);
    const issues = validateIdeaOutput({ ideas: [idea(), idea({ topic: "Other" })] }, context);
    expect(issues).toEqual([
      expect.objectContaining({ code: "PRIMARY_REUSED", severity: "MAJOR" }),
    ]);
  });

  it("gives every issue a field path under ideas", () => {
    const [issue] = validateIdeaOutput({ ideas: [idea({ primaryKnowledgeIds: ["c9"] })] }, context);
    expect(issue?.fieldPath).toBe("ideas.0.primaryKnowledgeIds");
  });
});

describe("dropNearDuplicates", () => {
  const a = idea({ coreMessage: "Message A about rice starch." });
  const b = idea({ coreMessage: "Message B about egg heat." });
  const c = idea({ coreMessage: "Message C about stock." });

  it("keeps everything when nothing is similar", async () => {
    const { kept, dropped } = await dropNearDuplicates(
      createFakeEmbeddingProvider(),
      [a, b, c],
      ["Old message."],
    );
    expect(kept).toEqual([a, b, c]);
    expect(dropped).toEqual([]);
  });

  it("drops an idea that repeats a recent one, and an idea that repeats an earlier one of the batch", async () => {
    const provider = createFakeEmbeddingProvider({
      similar: [
        ["Old rice message.", a.coreMessage],
        [b.coreMessage, c.coreMessage],
      ],
    });
    const { kept, dropped } = await dropNearDuplicates(provider, [a, b, c], ["Old rice message."]);
    expect(kept).toEqual([b]);
    expect(dropped.map((d) => [d.idea.coreMessage, d.reason, d.similarTo])).toEqual([
      [a.coreMessage, "RECENT", "Old rice message."],
      [c.coreMessage, "BATCH", b.coreMessage],
    ]);
    expect(dropped.every((d) => d.similarity >= 0.9)).toBe(true);
  });

  it("respects the threshold and an empty list", async () => {
    const provider = createFakeEmbeddingProvider({ similar: [[a.coreMessage, b.coreMessage]] });
    expect((await dropNearDuplicates(provider, [a, b], [], 0.9999)).kept).toEqual([a, b]);
    expect(await dropNearDuplicates(provider, [], ["x"])).toEqual({ kept: [], dropped: [] });
  });
});

describe("idea context and generation", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let brandId: string;
  let sourceId: string;
  let n = 0;
  const clock = manualClock("2026-10-07T12:00:00Z");
  let respond: (call: number) => unknown;
  let llm: ReturnType<typeof createFakeLLMProvider>;

  const build = (embeddings = createFakeEmbeddingProvider()) =>
    createServiceContext({
      db: t.db,
      logger,
      clock,
      llm,
      embeddings,
      actor: { type: "SYSTEM" },
    });

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    respond = () => ({ ideas: [] });
    llm = createFakeLLMProvider({ handler: (_request, call) => respond(call) });
    ctx = build();
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({ brandId, type: "GUIDE", title: "g", originalLanguage: "ru", rights })
      .returning();
    sourceId = source?.id ?? "";
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
        approvedVersion: 1,
        approvedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, n)),
        sourceAssetId: sourceId,
        embedding: axis(n),
        embeddingModel: "fake-embedding",
        ...over,
      })
      .returning();
    return row?.id ?? "";
  };
  const addIdea = async (over: Partial<typeof schema.masterIdeas.$inferInsert> = {}) => {
    const [row] = await t.db
      .insert(schema.masterIdeas)
      .values({
        brandId,
        topic: "Тема",
        category: "EGGS",
        angle: "MYTH_VS_FACT",
        coreMessage: "An older core message.",
        origin: "MANUAL",
        ...over,
      })
      .returning();
    return row?.id ?? "";
  };
  const market = async (code: string) => {
    const [row] = await t.db.select().from(schema.markets).where(eq(schema.markets.code, code));
    return row?.id ?? "";
  };
  const addProduct = async (code: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") => {
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
  const addOffer = async (
    productId: string,
    marketCode: string,
    over: Partial<typeof schema.offers.$inferInsert> = {},
  ) =>
    t.db.insert(schema.offers).values({
      marketId: await market(marketCode),
      productId,
      name: "Offer",
      type: "LEAD_MAGNET",
      currency: "EUR",
      status: "ACTIVE",
      ...over,
    });

  describe("buildIdeaContext", () => {
    it("fails when there is no approved card", async () => {
      await addCard({ reviewStatus: "NEEDS_REVIEW" });
      await expect(buildIdeaContext(ctx, { count: 3 })).rejects.toBeInstanceOf(InvalidStateError);
    });

    it("collects cards, active markets, the taxonomy and the options", async () => {
      const id = await addCard({ approvedVersion: 4 });
      const { input, pool } = await buildIdeaContext(ctx, {
        count: 3,
        focus: "  rice  ",
        performanceMemory: " Myth posts saved best. ",
      });
      expect(input).toMatchObject({
        count: 3,
        focus: "rice",
        performanceMemory: "Myth posts saved best.",
        cards: [{ id, version: 4, category: "GRAINS_RICE_PASTA", language: "ru" }],
      });
      expect(input.markets.map((m) => m.code)).toEqual(["es-ES", "en"]);
      expect(input.taxonomy.categories.map((c) => c.code)).toContain("GRAINS_RICE_PASTA");
      expect(input.taxonomy.angles.map((c) => c.code)).toContain("COMMON_MISTAKE");
      expect(pool).toEqual({ matched: 1, exclusionApplied: false });
    });

    it("omits an empty focus and performance memory", async () => {
      await addCard();
      const { input } = await buildIdeaContext(ctx, {
        count: 1,
        focus: "  ",
        performanceMemory: "",
      });
      expect(input).not.toHaveProperty("focus");
      expect(input).not.toHaveProperty("performanceMemory");
    });

    it("filters the pool by category and language", async () => {
      const rice = await addCard();
      await addCard({ category: "EGGS" });
      await addCard({ language: "es" });
      expect(
        (
          await buildIdeaContext(ctx, {
            count: 1,
            categories: ["GRAINS_RICE_PASTA"],
            language: "ru",
          })
        ).input.cards.map((c) => c.id),
      ).toEqual([rice]);
    });

    it("lists ideas of the last 60 days of any status, newest first", async () => {
      await addCard();
      await addIdea({ topic: "old", createdAt: new Date(clock.now().getTime() - 61 * DAY) });
      await addIdea({
        topic: "older in window",
        createdAt: new Date(clock.now().getTime() - 59 * DAY),
        status: "REJECTED",
      });
      await addIdea({
        topic: "newest",
        createdAt: new Date(clock.now().getTime() - 1 * DAY),
        status: "ACCEPTED",
      });
      const { input } = await buildIdeaContext(ctx, { count: 1 });
      expect(input.recentIdeas.map((i) => [i.topic, i.status])).toEqual([
        ["newest", "ACCEPTED"],
        ["older in window", "REJECTED"],
      ]);
    });

    it("lists active offers of active products in active markets, highest priority first", async () => {
      await addCard();
      const guide = await addProduct("GUIDE");
      const course = await addProduct("COURSE");
      const retired = await addProduct("OLD", "INACTIVE");
      await addOffer(guide, "en", { name: "Low", priority: 1 });
      await addOffer(guide, "es-ES", { name: "High", priority: 9 });
      await addOffer(course, "en", { name: "Draft", status: "DRAFT", priority: 99 });
      await addOffer(course, "fr-FR", { name: "Inactive market", priority: 50 });
      await addOffer(retired, "en", { name: "Retired product", priority: 70 });
      const { input } = await buildIdeaContext(ctx, { count: 1 });
      expect(
        input.offers.map((o) => [o.offerName, o.productCode, o.marketCode, o.priority]),
      ).toEqual([
        ["High", "GUIDE", "es-ES", 9],
        ["Low", "GUIDE", "en", 1],
      ]);
    });

    it("drops cards used as PRIMARY in the last 30 days when enough others remain", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 42; i += 1) ids.push(await addCard());
      const ideaId = await addIdea({ createdAt: new Date(clock.now().getTime() - 3 * DAY) });
      await t.db.insert(schema.masterIdeaKnowledge).values({
        masterIdeaId: ideaId,
        knowledgeItemId: ids[0] ?? "",
        knowledgeVersion: 1,
        role: "PRIMARY",
      });
      const { input, pool } = await buildIdeaContext(ctx, { count: 1 });
      expect(pool).toEqual({ matched: 42, exclusionApplied: true });
      expect(input.cards.map((c) => c.id)).not.toContain(ids[0]);
      expect(input.cards).toHaveLength(41);
    });
  });

  describe("generateIdeaDrafts", () => {
    const answerFor = (ids: string[], over: Partial<Idea>[] = [{}]) => ({
      ideas: over.map((o, i) =>
        idea({
          topic: `Idea ${i + 1}`,
          coreMessage: `Core message number ${i + 1}.`,
          primaryKnowledgeIds: [ids[i] ?? ids[0] ?? ""],
          ...o,
        }),
      ),
    });

    it("returns validated ideas, logs one run and records the cards it was given", async () => {
      const ids = [await addCard(), await addCard(), await addCard()];
      respond = () => answerFor(ids, [{}, {}]);
      const result = await generateIdeaDrafts(ctx, { count: 3, focus: "rice" });
      expect(result.status).toBe("SUCCEEDED");
      expect(result.ideas.map((i) => i.topic)).toEqual(["Idea 1", "Idea 2"]);
      expect(result.dropped).toEqual([]);
      expect(result.context).toMatchObject({
        cardIds: expect.arrayContaining(ids),
        recentIdeaCount: 0,
      });
      const runs = await t.db.select().from(schema.generationRuns);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        stage: "IDEA_GENERATION",
        promptId: "idea-generator",
        status: "SUCCEEDED",
        inputRefs: { knowledgeItemIds: expect.arrayContaining(ids) },
      });
    });

    it("repairs once when the first answer cites a card that was not given", async () => {
      const ids = [await addCard(), await addCard()];
      respond = (call) =>
        call === 0
          ? answerFor(ids, [{ primaryKnowledgeIds: ["not-a-card"] }])
          : answerFor(ids, [{}]);
      const result = await generateIdeaDrafts(ctx, { count: 2 });
      expect(result.status).toBe("REPAIRED");
      expect(result.ideas).toHaveLength(1);
      expect(result.runIds).toHaveLength(2);
      expect(llm.calls).toHaveLength(2);
    });

    it("repairs a blocking domain problem such as a product without an intent", async () => {
      const ids = [await addCard()];
      const guide = await addProduct("GUIDE");
      await addOffer(guide, "en");
      respond = (call) =>
        call === 0
          ? answerFor(ids, [{ productCode: "GUIDE", commercialIntent: "NONE" }])
          : answerFor(ids, [{ productCode: "GUIDE", commercialIntent: "LEAD_MAGNET" }]);
      const result = await generateIdeaDrafts(ctx, { count: 1 });
      expect(result.status).toBe("REPAIRED");
      expect(result.ideas[0]).toMatchObject({
        productCode: "GUIDE",
        commercialIntent: "LEAD_MAGNET",
      });
    });

    it("gives up with no ideas when the repair is invalid too", async () => {
      const ids = [await addCard()];
      respond = () => answerFor(ids, [{ primaryKnowledgeIds: ["nope"] }]);
      const result = await generateIdeaDrafts(ctx, { count: 1 });
      expect(result).toMatchObject({ status: "INVALID_OUTPUT", ideas: [], dropped: [] });
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("drops an idea that repeats a recent idea and keeps the rest", async () => {
      const ids = [await addCard(), await addCard()];
      await addIdea({
        coreMessage: "Rinsing risotto rice washes away the starch that makes it creamy.",
        createdAt: new Date(clock.now().getTime() - 5 * DAY),
      });
      respond = () =>
        answerFor(ids, [
          { coreMessage: "Rinsing risotto rice washes the creamy starch away." },
          {},
        ]);
      const embeddings = createFakeEmbeddingProvider({
        similar: [
          [
            "Rinsing risotto rice washes away the starch that makes it creamy.",
            "Rinsing risotto rice washes the creamy starch away.",
          ],
        ],
      });
      const result = await generateIdeaDrafts(build(embeddings), { count: 2 });
      expect(result.ideas.map((i) => i.topic)).toEqual(["Idea 2"]);
      expect(result.dropped).toEqual([
        expect.objectContaining({
          reason: "RECENT",
          idea: expect.objectContaining({ topic: "Idea 1" }),
        }),
      ]);
    });

    it("sends the cards, recent ideas and offers as tagged data to the model", async () => {
      const ids = [await addCard()];
      respond = () => answerFor(ids);
      await generateIdeaDrafts(ctx, { count: 1, focus: "rice" });
      const text = JSON.stringify(llm.calls[0]?.messages);
      expect(text).toContain("<knowledge_cards>");
      expect(text).toContain(`id=\\"${ids[0]}\\"`);
      expect(text).toContain("Editor's focus: rice");
    });
  });
});
