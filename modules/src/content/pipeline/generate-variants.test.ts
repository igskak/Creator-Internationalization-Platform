import { schema } from "@rc/db";
import type { MarketBrief } from "@rc/db/json";
import { asc, eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, TransientError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider, type StructuredRequest } from "@rc/lib/providers/llm";
import type { contentWriter, critic } from "@rc/prompts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, manualClock, type ServiceContext } from "../../core";
import { p0Registry } from "./context";
import { generateVariants, shuffled } from "./generate-variants";
import {
  marketOfRequest as marketOf,
  scriptedBrief,
  scriptedDraft,
  scriptedReview,
  scriptedVisualBrief,
  seedAcceptedIdea,
  textOfRequest as textOf,
} from "./scripted-model";

// Integration tests of the variant pipeline (07 §7.6.2, M2-13) with a scripted model: one answer
// per prompt and market, so each test can change one thing. Synthetic content only.

type Draft = contentWriter.ContentWriterOutput;
type Review = critic.CriticAnswer;

const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});
describe("generateVariants", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let _brandId: string;
  let card1: string;
  let card2: string;
  let ideaId: string;
  let variants: Record<string, string>;
  let llm: ReturnType<typeof createFakeLLMProvider>;
  /** Overrides per `promptId:market:callNumberForThatPair`; return undefined to use the default. */
  let script: (
    promptId: string,
    market: string,
    n: number,
    request: StructuredRequest<unknown>,
  ) => unknown;
  const seen = new Map<string, number>();
  let similar: string[][] = [];
  const clock = manualClock("2026-10-08T12:00:00Z");

  const cardIds = (): [string, string] => [card1, card2];
  const brief = (market: string): MarketBrief => scriptedBrief(market, cardIds());
  const draft = (market: string, tag = ""): Draft => scriptedDraft(market, cardIds(), tag);
  const review = scriptedReview;
  const badReview = (): Review =>
    review({
      verdict: "REQUEST_REWRITE",
      scores: { ...review().scores, factualFidelity: 2 },
      unsupportedClaims: [
        { fieldPath: "slides.2.slots.body", text: "Cures colds.", reason: "No card says it." },
      ],
      rewriteInstructions: "Remove the health claim.",
    });

  const makeCtx = () =>
    createServiceContext({
      db: t.db,
      logger,
      clock,
      llm,
      embeddings: createFakeEmbeddingProvider({ similar }),
      actor: { type: "SYSTEM" },
    });

  const calls = (promptId: string, market?: string) =>
    llm.calls.filter((r) => r.meta.promptId === promptId && (!market || marketOf(r) === market));
  const run = (id = "run-1", extra: { instruction?: string } = {}) =>
    generateVariants(ctx, {
      masterIdeaId: ideaId,
      variantIds: Object.values(variants),
      pipelineRunId: id,
      ...extra,
    });
  const variantRow = async (market: string) => {
    const [row] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variants[market] as string));
    return row as typeof schema.contentVariants.$inferSelect;
  };

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const seeded = await seedAcceptedIdea(t.db);
    ({ card1, card2, ideaId } = seeded);
    const markets = await t.db.select().from(schema.markets).orderBy(asc(schema.markets.sortOrder));
    variants = {};
    for (const market of markets.filter((m) => m.isActive)) {
      const [row] = await t.db
        .insert(schema.contentVariants)
        .values({ masterIdeaId: ideaId, marketId: market.id })
        .returning();
      variants[market.code] = row?.id ?? "";
    }
    seen.clear();
    similar = [];
    script = () => undefined;
    llm = createFakeLLMProvider({
      handler: (request) => {
        const market = marketOf(request);
        const key = `${request.meta.promptId}:${market}`;
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        const scripted = script(request.meta.promptId, market, n, request);
        if (scripted !== undefined) return scripted;
        if (request.meta.promptId === "market-adapter") return brief(market);
        if (request.meta.promptId === "content-writer") return draft(market, n > 0 ? `v${n}` : "");
        if (request.meta.promptId === "visual-director")
          return scriptedVisualBrief(textOf(request));
        return review();
      },
    });
    ctx = makeCtx();
  });
  afterEach(async () => {
    await t.close();
  });

  it("generates every market: plans in turn, drafts, reviews, then READY_FOR_REVIEW", async () => {
    const result = await run();
    expect(
      result.outcomes.map((o) => [o.marketCode, o.status, o.verdict, o.rewrites]).sort(),
    ).toEqual([
      ["en", "READY_FOR_REVIEW", "PASS", 0],
      ["es-ES", "READY_FOR_REVIEW", "PASS", 0],
    ]);
    expect(result.costUsd).not.toBeNull();

    const es = await variantRow("es-ES");
    expect(es).toMatchObject({
      status: "READY_FOR_REVIEW",
      hook: "Texto hook",
      hookType: "MISTAKE_CALLOUT",
      ctaType: "SAVE",
      criticVerdict: "PASS",
      generationVersion: "p1.1.0",
      lockVersion: 1,
      flags: [],
      lastError: null,
      templateSequence: ["A", "E", "B", "B", "F"],
    });
    expect(es.qualityScore).toBe("4.38");
    expect(es.slidesJson).toHaveLength(5);
    expect(new Set(es.slidesJson.map((s) => s.id)).size).toBe(5);
    expect(es.slidesJson[1]).toMatchObject({
      role: "MISTAKE",
      knowledgeIds: [card1],
      factual: true,
    });
    expect(es.contentLength).toMatchObject({ slides: 5, captionChars: es.caption?.length });
    expect(es.marketBriefJson).toMatchObject({ hookType: "MISTAKE_CALLOUT" });
    expect(es.differentiationReport).toMatchObject({
      verdict: "OK",
      thresholdsVersion: "d1-placeholder",
    });
    expect(es.generationConfig).toMatchObject({
      pipelineVersion: "1.1.0",
      embeddingModel: "fake-embedding",
      stages: {
        MARKET_ADAPTATION: { promptId: "market-adapter", promptVersion: 1 },
        CONTENT_WRITING: { promptId: "content-writer", promptVersion: 2 },
        CRITIC: { promptId: "critic", promptVersion: 2 },
        VISUAL_DIRECTION: { promptId: "visual-director", promptVersion: 1 },
      },
    });
    expect(es.pipelineState).toMatchObject({ pipelineRunId: "run-1", stage: "DONE" });
    expect(Object.keys(es.pipelineState?.runIds ?? {}).sort()).toEqual([
      "ADAPT",
      "CRITIC:0",
      "VISUAL",
      "WRITE:0",
    ]);
    // The visual brief covers every image slot of the slides and is stored with its style.
    expect(es.visualStyle).toBe(es.visualBriefJson?.visualStyle);
    expect(es.visualBriefJson?.slides.map((e) => `${e.slideId}/${e.slot}`)).toEqual(
      es.slidesJson.flatMap((s) =>
        (p0Registry.get(s.templateId)?.imageSlots
          ? Object.keys(p0Registry.get(s.templateId)?.imageSlots ?? {})
          : []
        ).map((slot) => `${s.id}/${slot}`),
      ),
    );

    const runs = await t.db.select().from(schema.generationRuns);
    expect(runs).toHaveLength(8);
    expect(runs.every((r) => r.masterIdeaId === ideaId && r.contentVariantId !== null)).toBe(true);
    const audits = (await t.db.select().from(schema.auditEvents)).map((a) => a.action);
    expect(audits.filter((a) => a === "variant.generation_started")).toHaveLength(2);
    expect(audits.filter((a) => a === "variant.generated")).toHaveLength(2);
  });

  it("plans the pictures after the review, one market after another", async () => {
    await run();
    const [first, second] = calls("visual-director");
    expect(calls("visual-director")).toHaveLength(2);
    expect(textOf(first as StructuredRequest<unknown>)).not.toContain("<brief market=");
    expect(textOf(second as StructuredRequest<unknown>)).toContain("<brief market=");
  });

  it("keeps the draft when the visual director gives no usable brief", async () => {
    script = (promptId) =>
      promptId === "visual-director"
        ? { concept: "x", visualStyle: "NOPE", slides: [] }
        : undefined;
    const result = await run();
    expect(result.outcomes.every((o) => o.status === "READY_FOR_REVIEW")).toBe(true);
    const es = await variantRow("es-ES");
    expect(es).toMatchObject({ status: "READY_FOR_REVIEW", visualBriefJson: null });
  });

  it("plans the markets one after another: the later plan sees the earlier one as a sibling", async () => {
    await run();
    const [first, second] = calls("market-adapter");
    expect(textOf(first as StructuredRequest<unknown>)).not.toContain("<plan market=");
    expect(textOf(second as StructuredRequest<unknown>)).toContain("<plan market=");
    expect(marketOf(first as StructuredRequest<unknown>)).not.toBe(
      marketOf(second as StructuredRequest<unknown>),
    );
  });

  it("orders the markets by the run id: same id, same order; the shuffle is stable", () => {
    expect(shuffled([1, 2, 3, 4, 5, 6], "a")).toEqual(shuffled([1, 2, 3, 4, 5, 6], "a"));
    const orders = new Set(
      ["a", "b", "c", "d", "e", "f", "g"].map((s) => shuffled([1, 2, 3, 4, 5], s).join()),
    );
    expect(orders.size).toBeGreaterThan(1);
    expect(shuffled([1, 2, 3], "a").sort()).toEqual([1, 2, 3]);
  });

  it("rewrites once when the critic finds an unsupported claim, then passes", async () => {
    script = (promptId, market, n) =>
      promptId === "critic" && market === "es-ES" && n === 0 ? badReview() : undefined;
    const result = await run();
    const es = result.outcomes.find((o) => o.marketCode === "es-ES");
    expect(es).toMatchObject({ status: "READY_FOR_REVIEW", verdict: "PASS", rewrites: 1 });
    expect(calls("content-writer", "es-ES")).toHaveLength(2);
    expect(calls("critic", "es-ES")).toHaveLength(2);
    const rewrite = textOf(calls("content-writer", "es-ES")[1] as StructuredRequest<unknown>);
    expect(rewrite).toContain("<rewrite>");
    expect(rewrite).toContain("Remove the health claim.");
    expect(rewrite).toContain("remove or rewrite");
    expect((await variantRow("es-ES")).hook).toBe("Texto hook v1");
    expect(Object.keys((await variantRow("es-ES")).pipelineState?.runIds ?? {}).sort()).toEqual([
      "ADAPT",
      "CRITIC:0",
      "CRITIC:1",
      "VISUAL",
      "WRITE:0",
      "WRITE:1",
    ]);
    // The other market was not asked again.
    expect(calls("content-writer", "en")).toHaveLength(1);
  });

  it("flags for a person after two rewrites that did not help, keeping the unresolved claim", async () => {
    script = (promptId, market) =>
      promptId === "critic" && market === "en" ? badReview() : undefined;
    const result = await run();
    const en = result.outcomes.find((o) => o.marketCode === "en");
    expect(en).toMatchObject({
      status: "READY_FOR_REVIEW",
      verdict: "FLAG_FOR_HUMAN",
      rewrites: 2,
    });
    expect(en?.flags).toContain("UNSUPPORTED_CLAIM");
    expect(calls("content-writer", "en")).toHaveLength(3);
    expect(calls("critic", "en")).toHaveLength(3);
    const row = await variantRow("en");
    expect(row).toMatchObject({ status: "READY_FOR_REVIEW", criticVerdict: "FLAG_FOR_HUMAN" });
    expect(row.flags).toContain("UNSUPPORTED_CLAIM");
    expect(row.criticReport?.humanAttention).toContain("Still unresolved after 2 rewrites.");
    // Field paths of the report use the stored slide ids, not the draft's indexes.
    const claim = row.criticReport?.unsupportedClaims[0];
    expect(claim?.fieldPath).toBe(`slides.${row.slidesJson[2]?.id}.slots.body`);
  });

  it("fails the variant whose plan copies its sibling's hook type and structure", async () => {
    script = (promptId, market) =>
      promptId === "market-adapter"
        ? {
            ...brief("es-ES"),
            unitsPolicy: { system: market === "es-ES" ? "METRIC" : "DUAL", conversions: [] },
          }
        : undefined;
    const result = await run();
    // The plan planned second breaks the sibling rule on both tries, so that variant is out.
    const failed = result.outcomes.filter((o) => o.status === "FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error?.code).toBe("INVALID_OUTPUT");
    expect(result.outcomes.filter((o) => o.status === "READY_FOR_REVIEW")).toHaveLength(1);
  });

  it("asks only the market generated later to rewrite when the hooks are the same post", async () => {
    similar = [["Texto hook", "Copy hook"]];
    ctx = makeCtx();
    const result = await run();
    const rewritten = result.outcomes.filter((o) => o.rewrites === 1);
    expect(rewritten).toHaveLength(1);
    const later = rewritten[0]?.marketCode as string;
    const earlier = later === "en" ? "es-ES" : "en";
    expect(calls("content-writer", later)).toHaveLength(2);
    expect(calls("content-writer", earlier)).toHaveLength(1);
    const instruction = textOf(calls("content-writer", later)[1] as StructuredRequest<unknown>);
    expect(instruction).toContain("Change the hook type and the slide structure; keep the facts.");
    // After the rewrite the pair is no longer alike.
    expect((await variantRow(later)).differentiationReport?.verdict).toBe("OK");
    expect((await variantRow(later)).criticVerdict).toBe("PASS");
    // The earlier market still carries the first report, which named the risk.
    expect((await variantRow(earlier)).flags).toEqual([]);
  });

  it("resumes with the same run id after a crash and repeats no finished model call", async () => {
    let crash = true;
    script = (promptId, market) => {
      if (promptId === "critic" && market === "en" && crash) {
        throw new TransientError("The provider is down.");
      }
      return undefined;
    };
    await expect(run("run-7")).rejects.toBeInstanceOf(TransientError);
    // Mid-run state: both variants still GENERATING with their progress recorded.
    const mid = await variantRow("en");
    expect(mid.status).toBe("GENERATING");
    expect(mid.pipelineState?.completedStages).toEqual(["ADAPT", "WRITE:0"]);
    const before = {
      adapters: calls("market-adapter").length,
      writers: calls("content-writer").length,
    };

    crash = false;
    const result = await run("run-7");
    expect(result.outcomes.map((o) => o.status)).toEqual(["READY_FOR_REVIEW", "READY_FOR_REVIEW"]);
    expect(calls("market-adapter")).toHaveLength(before.adapters);
    expect(calls("content-writer")).toHaveLength(before.writers);
    expect(calls("critic")).toHaveLength(3); // es-ES once, en twice (the crashed call and the retry)
    expect((await variantRow("en")).status).toBe("READY_FOR_REVIEW");
    expect(Object.keys((await variantRow("en")).pipelineState?.runIds ?? {}).sort()).toEqual([
      "ADAPT",
      "CRITIC:0",
      "VISUAL",
      "WRITE:0",
    ]);
  });

  it("returns a failed variant to DRAFT with GENERATION_FAILED while the other market finishes", async () => {
    script = (promptId, market) => {
      if (promptId !== "content-writer" || market !== "en") return undefined;
      const bad = draft("en");
      // A slot far over its limit, every time: the repair cannot fix what the model repeats.
      const slide = bad.slides[1] as Draft["slides"][number];
      return {
        ...bad,
        slides: [
          bad.slides[0],
          { ...slide, slots: [{ slot: "body", text: "x".repeat(400) }] },
          ...bad.slides.slice(2),
        ],
      };
    };
    const result = await run();
    expect(result.outcomes.map((o) => [o.marketCode, o.status]).sort()).toEqual([
      ["en", "FAILED"],
      ["es-ES", "READY_FOR_REVIEW"],
    ]);
    const en = await variantRow("en");
    expect(en).toMatchObject({
      status: "DRAFT",
      flags: ["GENERATION_FAILED"],
      pipelineState: null,
    });
    expect(en.lastError).toMatchObject({ code: "INVALID_OUTPUT", details: { stage: "WRITE:0" } });
    expect(calls("content-writer", "en")).toHaveLength(2); // the first answer and the repair
    expect(calls("critic", "en")).toHaveLength(0);
    expect((await t.db.select().from(schema.auditEvents)).map((a) => a.action)).toContain(
      "variant.generation_failed",
    );
    // A new run starts clean and clears the failure.
    script = () => undefined;
    const retry = await generateVariants(ctx, {
      masterIdeaId: ideaId,
      variantIds: [variants.en as string],
      pipelineRunId: "run-2",
    });
    expect(retry.outcomes[0]).toMatchObject({ status: "READY_FOR_REVIEW" });
    expect(await variantRow("en")).toMatchObject({ flags: [], lastError: null });
  });

  it("fails the variants of a run that dies of a permanent error and rethrows", async () => {
    script = (promptId) => {
      if (promptId === "content-writer") throw new Error("boom");
      return undefined;
    };
    await expect(run()).rejects.toThrow("boom");
    expect((await variantRow("es-ES")).status).toBe("DRAFT");
    expect((await variantRow("es-ES")).flags).toEqual(["GENERATION_FAILED"]);
  });

  it("hands the draft to a person when the critic cannot be used", async () => {
    script = (promptId, market) =>
      promptId === "critic" && market === "es-ES"
        ? review({ scores: { ...review().scores, overall: 9 } })
        : undefined;
    const result = await run();
    const es = result.outcomes.find((o) => o.marketCode === "es-ES");
    expect(es).toMatchObject({ status: "READY_FOR_REVIEW", verdict: "FLAG_FOR_HUMAN" });
    const row = await variantRow("es-ES");
    expect(row.qualityScore).toBeNull();
    expect(row.criticReport).toBeNull();
    expect(row.status).toBe("READY_FOR_REVIEW");
  });

  it("sends a person's instruction to the writer", async () => {
    await run("run-1", { instruction: "Open with a question." });
    const first = textOf(calls("content-writer", "es-ES")[0] as StructuredRequest<unknown>);
    expect(first).toContain("<rewrite>");
    expect(first).toContain("Open with a question.");
    expect(first).toContain("No previous draft.");
  });

  describe("the comparison of siblings the run did not touch (M2-13b)", () => {
    /** The English plan and draft with the Spanish template order: the same shape, another hook type. */
    const sameShape = () => {
      script = (promptId, market) => {
        if (market !== "en") return undefined;
        if (promptId === "market-adapter") {
          return {
            ...brief("es-ES"),
            hookType: "MYTH_BUST",
            unitsPolicy: { system: "DUAL", conversions: [] },
          };
        }
        if (promptId === "content-writer") {
          const es = JSON.stringify(draft("es-ES")).replaceAll("Texto", "Copy");
          return { ...JSON.parse(es), hookType: "MYTH_BUST" };
        }
        return undefined;
      };
    };
    const regenerateEnglish = () =>
      generateVariants(ctx, {
        masterIdeaId: ideaId,
        variantIds: [variants.en as string],
        pipelineRunId: "run-en",
      });

    it("clears the duplication warning of the sibling when the regenerated market no longer looks like it", async () => {
      sameShape();
      await run();
      const before = await variantRow("es-ES");
      expect(before.flags).toContain("DUPLICATION_RISK");
      expect(before.differentiationReport).toMatchObject({
        verdict: "WARN",
        templateSequenceSimilarity: 1,
      });

      script = () => undefined; // the English draft is regenerated with its own structure
      await regenerateEnglish();
      const after = await variantRow("es-ES");
      expect(after.flags).not.toContain("DUPLICATION_RISK");
      expect(after.differentiationReport).toMatchObject({ verdict: "OK" });
      expect((await variantRow("en")).flags).toEqual([]);
      // Only the comparison changed: the Spanish draft itself is as it was.
      expect(after).toMatchObject({
        hook: before.hook,
        status: "READY_FOR_REVIEW",
        lockVersion: before.lockVersion,
      });
      expect(after.slidesJson).toEqual(before.slidesJson);
      const audits = (await t.db.select().from(schema.auditEvents)).filter(
        (a) => a.action === "variant.comparison_refreshed",
      );
      expect(audits).toEqual([
        expect.objectContaining({
          entityId: variants["es-ES"],
          data: { verdict: "OK", flags: [] },
        }),
      ]);
    });

    it("adds the warning to a sibling that now looks like the regenerated market", async () => {
      await run();
      expect((await variantRow("es-ES")).flags).toEqual([]);
      sameShape();
      await regenerateEnglish();
      const es = await variantRow("es-ES");
      expect(es.flags).toEqual(["DUPLICATION_RISK"]);
      expect(es.differentiationReport).toMatchObject({ verdict: "WARN" });
    });

    it("leaves a published sibling and a sibling being written alone", async () => {
      sameShape();
      await run();
      await t.db
        .update(schema.contentVariants)
        .set({ status: "PUBLISHED" })
        .where(eq(schema.contentVariants.id, variants["es-ES"] as string));
      const published = await variantRow("es-ES");
      script = () => undefined;
      await t.db
        .update(schema.contentVariants)
        .set({ status: "READY_FOR_REVIEW" })
        .where(eq(schema.contentVariants.id, variants.en as string));
      await regenerateEnglish();
      expect(await variantRow("es-ES")).toEqual(published);
    });

    it("keeps the flags and shows the numbers of the pair as it is now when the verdict stays OK", async () => {
      await run();
      const before = await variantRow("es-ES");
      await regenerateEnglish();
      const es = await variantRow("es-ES");
      const en = await variantRow("en");
      expect(es.flags).toEqual([]);
      // Both markets show the same comparison: the pair of the new English draft and the Spanish one.
      expect(es.differentiationReport).toEqual(en.differentiationReport);
      expect(es.differentiationReport?.verdict).toBe("OK");
      expect(es.hook).toBe(before.hook);
    });
  });

  describe("locking", () => {
    it("stops before touching anything when another run holds a variant", async () => {
      await t.db
        .update(schema.contentVariants)
        .set({
          status: "GENERATING",
          pipelineState: {
            pipelineRunId: "other",
            stage: "WRITE:0",
            startedAt: "x",
            completedStages: [],
            runIds: {},
          },
        })
        .where(eq(schema.contentVariants.id, variants["es-ES"] as string));
      await expect(run()).rejects.toBeInstanceOf(InvalidStateError);
      expect((await variantRow("en")).status).toBe("DRAFT");
      expect(llm.calls).toHaveLength(0);
    });

    it("needs an ACCEPTED idea and variants of that idea", async () => {
      await t.db.update(schema.masterIdeas).set({ status: "PROPOSED" });
      await expect(run()).rejects.toBeInstanceOf(InvalidStateError);
      await t.db.update(schema.masterIdeas).set({ status: "ACCEPTED" });
      await expect(
        generateVariants(ctx, {
          masterIdeaId: ideaId,
          variantIds: [crypto.randomUUID()],
          pipelineRunId: "x",
        }),
      ).rejects.toThrow("Some variants do not belong to this idea.");
    });

    it("does not take a variant that is APPROVED", async () => {
      await t.db
        .update(schema.contentVariants)
        .set({ status: "APPROVED" })
        .where(eq(schema.contentVariants.id, variants.en as string));
      await expect(run()).rejects.toBeInstanceOf(InvalidStateError);
    });
  });
});
