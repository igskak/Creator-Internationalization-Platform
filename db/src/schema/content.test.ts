import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CriticReport,
  CtaSpec,
  DifferentiationReport,
  GenerationConfig,
  MarketBrief,
  PipelineState,
  RightsPolicy,
  Slide,
} from "../json";
import { createTestDb, type TestDb } from "../test-db";
import {
  contentVariants,
  masterIdeaKnowledge,
  masterIdeas,
  offers,
  products,
  voiceExamples,
} from "./content";
import { brands, markets } from "./core";
import { generationRuns, knowledgeItems, sourceAssets } from "./knowledge";

// Synthetic data only.
const rights: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "DENIED",
};

const slide: Slide = {
  id: "s1",
  index: 0,
  role: "HOOK",
  templateId: "A",
  slots: { headline: "Stop rinsing the rice" },
  images: { background: {} },
  knowledgeIds: [],
  factual: false,
};

describe("0003_content", () => {
  let t: TestDb;
  let brandId: string;
  let esId: string;
  let enId: string;
  let cardId: string;
  let productId: string;

  const newIdea = async (topic = "Idea") => {
    const [idea] = await t.db
      .insert(masterIdeas)
      .values({
        brandId,
        topic,
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "Synthetic core message",
        origin: "MANUAL",
      })
      .returning();
    return idea?.id ?? "";
  };

  beforeAll(async () => {
    t = await createTestDb();
    const [brand] = await t.db.insert(brands).values({ slug: "c-brand", name: "C" }).returning();
    brandId = brand?.id ?? "";
    const base = { brandId, country: "ES", language: "es", timezone: "Europe/Madrid" };
    const [es] = await t.db
      .insert(markets)
      .values({
        ...base,
        code: "es-ES",
        displayName: "Spain",
        currency: "EUR",
        measurementSystem: "METRIC",
      })
      .returning();
    const [en] = await t.db
      .insert(markets)
      .values({
        ...base,
        code: "en",
        displayName: "English",
        country: "GLOBAL",
        language: "en",
        currency: "USD",
        measurementSystem: "DUAL",
      })
      .returning();
    esId = es?.id ?? "";
    enId = en?.id ?? "";
    const [source] = await t.db
      .insert(sourceAssets)
      .values({ brandId, type: "GUIDE", title: "Guide", originalLanguage: "ru", rights })
      .returning();
    const [card] = await t.db
      .insert(knowledgeItems)
      .values({
        brandId,
        title: "Card",
        category: "GRAINS_RICE_PASTA",
        claim: "Synthetic claim",
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        sourceAssetId: source?.id,
      })
      .returning();
    cardId = card?.id ?? "";
    const [product] = await t.db
      .insert(products)
      .values({
        brandId,
        code: "RICE-GUIDE",
        name: "Rice guide",
        type: "GUIDE",
        originalLanguage: "ru",
      })
      .returning();
    productId = product?.id ?? "";
  });

  afterAll(async () => {
    await t.close();
  });

  it("enables RLS on every content table", async () => {
    const names = [
      "products",
      "offers",
      "master_ideas",
      "master_idea_knowledge",
      "content_variants",
      "voice_examples",
    ];
    const result = await t.db.execute<{ relname: string; relrowsecurity: boolean }>(sql`
      select relname, relrowsecurity from pg_class
      where relname in (${sql.join(
        names.map((n) => sql`${n}`),
        sql`, `,
      )})`);
    expect(result.rows).toHaveLength(names.length);
    expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("applies product and offer defaults and round-trips money", async () => {
    const [product] = await t.db.select().from(products).where(eq(products.id, productId));
    expect(product).toMatchObject({ status: "ACTIVE", description: null });
    const [offer] = await t.db
      .insert(offers)
      .values({
        marketId: esId,
        productId,
        name: "Guía de arroz",
        type: "PAID_PRODUCT",
        price: "19.90",
        currency: "EUR",
      })
      .returning();
    expect(offer).toMatchObject({ price: "19.90", currency: "EUR", priority: 0, status: "DRAFT" });
  });

  it("rejects values outside the text vocabularies and duplicate product codes", async () => {
    await expect(
      t.db.insert(products).values({
        brandId,
        code: "BAD-TYPE",
        name: "x",
        type: "PODCAST" as "GUIDE",
        originalLanguage: "ru",
      }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(products).values({
        brandId,
        code: "RICE-GUIDE",
        name: "dup",
        type: "GUIDE",
        originalLanguage: "ru",
      }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(offers).values({
        marketId: esId,
        productId,
        name: "x",
        type: "LEAD_MAGNET",
        currency: "EUR",
        status: "LIVE" as "DRAFT",
      }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(masterIdeas).values({
        brandId,
        topic: "t",
        category: "c",
        angle: "a",
        coreMessage: "m",
        origin: "ROBOT" as "MANUAL",
      }),
    ).rejects.toThrow();
  });

  it("applies master idea defaults and links cards with a role and version", async () => {
    const ideaId = await newIdea("Defaults");
    const [idea] = await t.db.select().from(masterIdeas).where(eq(masterIdeas.id, ideaId));
    expect(idea).toMatchObject({
      status: "PROPOSED",
      recommendedFormat: "CAROUSEL",
      commercialIntent: "NONE",
      evidenceSummary: "",
      productId: null,
    });
    await t.db.insert(masterIdeaKnowledge).values({
      masterIdeaId: ideaId,
      knowledgeItemId: cardId,
      knowledgeVersion: 2,
      role: "PRIMARY",
    });
    await expect(
      t.db.insert(masterIdeaKnowledge).values({
        masterIdeaId: ideaId,
        knowledgeItemId: cardId,
        knowledgeVersion: 2,
        role: "SUPPORTING",
      }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(masterIdeaKnowledge).values({
        masterIdeaId: await newIdea("Bad role"),
        knowledgeItemId: cardId,
        knowledgeVersion: 1,
        role: "MAIN" as "PRIMARY",
      }),
    ).rejects.toThrow();
  });

  it("round-trips the JSON columns of a variant", async () => {
    const ideaId = await newIdea("Round trip");
    const cta: CtaSpec = { type: "DM_KEYWORD", text: "DM RICE", keyword: "RICE", linkMode: "DM" };
    const brief: MarketBrief = {
      audienceFraming: "Home cooks",
      terminology: [{ concept: "rinse", localTerm: "lavar", avoid: ["enjuagar"] }],
      substitutions: [],
      unitsPolicy: { system: "METRIC", conversions: [] },
      culturalHooks: [],
      examples: [],
      tone: "warm",
      hookType: "MYTH_BUST",
      slidePlan: [{ role: "HOOK", templateId: "A", purpose: "hook", knowledgeIds: [cardId] }],
      ctaApproach: { ctaType: "DM_KEYWORD" },
      risks: [],
      differentiationNotes: "",
    };
    const critic: CriticReport = {
      verdict: "PASS",
      iteration: 0,
      scores: {
        factualFidelity: 5,
        sourceCoverage: 4,
        localization: 4,
        originality: 4,
        brandVoice: 4,
        structure: 5,
        cta: 4,
        overall: 4.3,
      },
      unsupportedClaims: [],
      issues: [],
      deterministicIssues: [],
    };
    const diff: DifferentiationReport = {
      hookSimilarity: 0.2,
      slideTextSimilarity: 0.3,
      templateSequenceSimilarity: 0.5,
      sameHookType: false,
      verdict: "OK",
      reasons: [],
      thresholdsVersion: "d1",
    };
    const config: GenerationConfig = {
      pipelineVersion: "p1.0.0",
      stages: { CRITIC: { promptId: "critic", promptVersion: 1, model: "claude-opus-5-5" } },
      embeddingModel: "text-embedding-3-small",
    };
    const state: PipelineState = {
      pipelineRunId: "run-1",
      stage: "CRITIC",
      startedAt: "2026-10-07T10:00:00.000Z",
      completedStages: ["MARKET_ADAPTATION", "CONTENT_WRITING"],
      runIds: { MARKET_ADAPTATION: "r1" },
    };
    const [created] = await t.db
      .insert(contentVariants)
      .values({
        masterIdeaId: ideaId,
        marketId: esId,
        hook: "Deja de lavar el arroz",
        hookType: "MYTH_BUST",
        ctaJson: cta,
        slidesJson: [slide],
        marketBriefJson: brief,
        criticVerdict: "PASS",
        criticReport: critic,
        differentiationReport: diff,
        generationConfig: config,
        pipelineState: state,
        qualityScore: "4.30",
        templateSequence: ["A", "B"],
        flags: ["KNOWLEDGE_CHANGED"],
      })
      .returning();
    const [row] = await t.db
      .select()
      .from(contentVariants)
      .where(eq(contentVariants.id, created?.id ?? ""));
    expect(row).toMatchObject({
      status: "DRAFT",
      format: "CAROUSEL",
      ctaJson: cta,
      slidesJson: [slide],
      marketBriefJson: brief,
      criticReport: critic,
      differentiationReport: diff,
      generationConfig: config,
      pipelineState: state,
      qualityScore: "4.30",
      templateSequence: ["A", "B"],
      flags: ["KNOWLEDGE_CHANGED"],
      hashtags: [],
      lockVersion: 0,
      visualBriefJson: null,
      campaignId: null,
    });
  });

  it("allows one non-rejected variant per idea, market and format (partial unique index)", async () => {
    const ideaId = await newIdea("Unique");
    const first = { masterIdeaId: ideaId, marketId: esId };
    const [created] = await t.db.insert(contentVariants).values(first).returning();
    await expect(t.db.insert(contentVariants).values(first)).rejects.toThrow();
    // Another market and another format are fine.
    await t.db.insert(contentVariants).values({ masterIdeaId: ideaId, marketId: enId });
    await t.db.insert(contentVariants).values({ ...first, format: "REEL" });
    // Once rejected, the slot is free again.
    await t.db
      .update(contentVariants)
      .set({ status: "REJECTED" })
      .where(eq(contentVariants.id, created?.id ?? ""));
    await t.db.insert(contentVariants).values(first);
    // A rejected row never blocks, and two rejected rows can coexist.
    await t.db.insert(contentVariants).values({ ...first, status: "REJECTED" });
  });

  it("keeps campaign ids unique and updated_at current", async () => {
    const ideaId = await newIdea("Campaign");
    const [a] = await t.db
      .insert(contentVariants)
      .values({ masterIdeaId: ideaId, marketId: esId, campaignId: "rc-es-001" })
      .returning();
    await expect(
      t.db
        .insert(contentVariants)
        .values({ masterIdeaId: ideaId, marketId: enId, campaignId: "rc-es-001" }),
    ).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 15));
    const [updated] = await t.db
      .update(contentVariants)
      .set({ hook: "new" })
      .where(eq(contentVariants.id, a?.id ?? ""))
      .returning();
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(a?.updatedAt.getTime() ?? 0);
  });

  it("links generation runs to ideas and variants", async () => {
    const ideaId = await newIdea("Runs");
    const [variant] = await t.db
      .insert(contentVariants)
      .values({ masterIdeaId: ideaId, marketId: esId })
      .returning();
    const [run] = await t.db
      .insert(generationRuns)
      .values({
        stage: "CRITIC",
        promptId: "critic",
        promptVersion: 1,
        promptHash: "h",
        provider: "fake",
        model: "fake",
        params: {},
        inputHash: "i",
        status: "SUCCEEDED",
        masterIdeaId: ideaId,
        contentVariantId: variant?.id,
      })
      .returning();
    expect(run).toMatchObject({ masterIdeaId: ideaId, contentVariantId: variant?.id });
    await expect(
      t.db.insert(generationRuns).values({
        stage: "CRITIC",
        promptId: "critic",
        promptVersion: 1,
        promptHash: "h",
        provider: "fake",
        model: "fake",
        params: {},
        inputHash: "i",
        status: "SUCCEEDED",
        contentVariantId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow();
  });

  it("restricts deleting an idea that has variants or card links", async () => {
    const ideaId = await newIdea("Restrict");
    await t.db.insert(contentVariants).values({ masterIdeaId: ideaId, marketId: esId });
    await expect(t.db.delete(masterIdeas).where(eq(masterIdeas.id, ideaId))).rejects.toThrow();
  });

  it("stores voice examples for one market or all markets", async () => {
    const [all] = await t.db
      .insert(voiceExamples)
      .values({ kind: "RULE", note: "Prefer short sentences", source: "SEED" })
      .returning();
    expect(all).toMatchObject({ marketId: null, isActive: true, reviewEventId: null });
    await t.db.insert(voiceExamples).values({
      marketId: enId,
      kind: "EDIT_PAIR",
      beforeText: "before",
      afterText: "after",
      language: "en",
      source: "REVIEW_EVENT",
    });
    await expect(
      t.db.insert(voiceExamples).values({ kind: "OTHER" as "RULE", source: "SEED" }),
    ).rejects.toThrow();
  });
});
