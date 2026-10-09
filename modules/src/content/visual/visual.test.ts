import { schema } from "@rc/db";
import type { Slide, VisualBrief } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scriptedVisualBrief } from "../../ai/scripted-answers";
import { createServiceContext, manualClock, type ServiceContext } from "../../core";
import { p0Registry } from "../pipeline/context";
import { seedAcceptedIdea, textOfRequest } from "../pipeline/scripted-model";
import { regenerateVisualBrief } from "./regenerate";
import { type VisualValidationContext, validateVisualBrief } from "./validate";

// Synthetic content only.

const slide = (id: string, index: number, templateId: string, role = "FACT"): Slide => ({
  id,
  index,
  role: role as Slide["role"],
  templateId: templateId as Slide["templateId"],
  slots: { headline: "x" },
  images: {},
  knowledgeIds: [],
  factual: false,
});
const slides = [slide("s1", 0, "A", "HOOK"), slide("s2", 1, "B"), slide("s3", 2, "F", "CTA")];

const context: VisualValidationContext = {
  slides,
  templates: p0Registry,
  libraryIds: new Set(["lib-1"]),
  visualStyles: new Set(["WARM_RUSTIC"]),
  hypothesisIds: new Set(["h1"]),
};
const entry = (
  over: Partial<VisualBrief["slides"][number]> = {},
): VisualBrief["slides"][number] => ({
  slideId: "s1",
  slot: "hero",
  source: "GENERATE",
  prompt: "Macro photo of rice in a bowl, soft light",
  negativePrompt: "text",
  composition: "Low subject.",
  aspect: "4:5",
  ...over,
});
const brief = (over: Partial<VisualBrief> = {}): VisualBrief => ({
  concept: "c",
  visualStyle: "WARM_RUSTIC",
  slides: [entry()],
  differentiationFromSibling: "",
  ...over,
});
const codes = (b: VisualBrief, c = context) => validateVisualBrief(b, c).map((i) => i.code);

describe("validateVisualBrief", () => {
  it("accepts a brief that covers the required slot", () => {
    expect(codes(brief())).toEqual([]);
    expect(codes(brief({ hypothesisId: "h1" }))).toEqual([]);
  });

  it("blocks a required slot that has no picture or is NONE", () => {
    expect(codes(brief({ slides: [] }))).toEqual(["VISUAL_SLOT_UNCOVERED"]);
    expect(codes(brief({ slides: [entry({ source: "NONE" })] }))).toEqual([
      "VISUAL_SLOT_UNCOVERED",
    ]);
  });

  it("allows an optional slot to stay empty or to be filled", () => {
    const optional = entry({ slideId: "s2", slot: "side", aspect: "1:1" });
    expect(codes(brief({ slides: [entry(), optional] }))).toEqual([]);
    expect(codes(brief({ slides: [entry(), { ...optional, source: "NONE" }] }))).toEqual([]);
  });

  it("blocks unknown slides and slots and duplicates", () => {
    expect(codes(brief({ slides: [entry(), entry({ slideId: "zz" })] }))).toContain(
      "VISUAL_SLIDE_UNKNOWN",
    );
    expect(codes(brief({ slides: [entry(), entry({ slot: "banner" })] }))).toContain(
      "VISUAL_SLOT_UNKNOWN",
    );
    expect(codes(brief({ slides: [entry(), entry()] }))).toContain("VISUAL_SLOT_DUPLICATE");
  });

  it("needs a prompt for a generated picture and flags text in it", () => {
    expect(codes(brief({ slides: [entry({ prompt: " " })] }))).toContain("VISUAL_PROMPT_MISSING");
    const issues = validateVisualBrief(
      brief({ slides: [entry({ prompt: "Rice with a logo and text on the pack" })] }),
      context,
    );
    expect(issues).toMatchObject([{ code: "VISUAL_PROMPT_TEXT", severity: "MAJOR" }]);
  });

  it("accepts only library photos that were offered", () => {
    expect(
      codes(brief({ slides: [entry({ source: "LIBRARY", libraryAssetId: "lib-1" })] })),
    ).toEqual([]);
    expect(
      codes(brief({ slides: [entry({ source: "LIBRARY", libraryAssetId: "other" })] })),
    ).toEqual(["VISUAL_LIBRARY_UNKNOWN"]);
    expect(codes(brief({ slides: [entry({ source: "LIBRARY" })] }))).toEqual([
      "VISUAL_LIBRARY_UNKNOWN",
    ]);
  });

  it("checks the style, the hypothesis and the aspect", () => {
    expect(codes(brief({ visualStyle: "NOPE" }))).toEqual(["VISUAL_STYLE_UNKNOWN"]);
    expect(codes(brief({ hypothesisId: "nope" }))).toEqual(["VISUAL_HYPOTHESIS_UNKNOWN"]);
    const issues = validateVisualBrief(brief({ slides: [entry({ aspect: "1:1" })] }), context);
    expect(issues).toMatchObject([{ code: "VISUAL_ASPECT", severity: "MINOR" }]);
  });
});

describe("regenerateVisualBrief", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let variantId: string;
  let llm: ReturnType<typeof createFakeLLMProvider>;
  let answer: (text: string) => unknown;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const { ideaId } = await seedAcceptedIdea(t.db);
    const [market] = await t.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.code, "es-ES"));
    answer = (text) => scriptedVisualBrief(text);
    llm = createFakeLLMProvider({ handler: (request) => answer(textOfRequest(request)) });
    ctx = createServiceContext({
      db: t.db,
      logger: createLogger({
        service: "jobs",
        env: "test",
        level: "fatal",
        destination: { write: () => {} },
      }),
      clock: manualClock("2026-10-10T12:00:00Z"),
      llm,
      embeddings: createFakeEmbeddingProvider(),
      actor: { type: "SYSTEM" },
    });
    const [row] = await t.db
      .insert(schema.contentVariants)
      .values({
        masterIdeaId: ideaId,
        marketId: market?.id ?? "",
        status: "READY_FOR_REVIEW",
        slidesJson: slides,
      })
      .returning();
    variantId = row?.id ?? "";
  });

  afterEach(async () => {
    await t.close();
  });

  const row = async () => {
    const [v] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variantId));
    return v as typeof schema.contentVariants.$inferSelect;
  };

  it("plans the pictures again, stores the brief and audits it", async () => {
    const { visualBrief } = await regenerateVisualBrief(ctx, { variantId });
    expect(visualBrief.slides.map((e) => e.slot)).toEqual(["hero", "side", "product"]);
    const v = await row();
    expect(v.visualBriefJson).toEqual(visualBrief);
    expect(v.visualStyle).toBe(visualBrief.visualStyle);
    expect(v.lockVersion).toBe(1);
    const audits = await t.db.select().from(schema.auditEvents);
    expect(audits.map((a) => a.action)).toContain("variant.visual_brief_regenerated");
    const runs = await t.db.select().from(schema.generationRuns);
    expect(runs.every((r) => r.contentVariantId === variantId)).toBe(true);
  });

  it("keeps the old brief when the answer is not usable", async () => {
    await regenerateVisualBrief(ctx, { variantId });
    const before = (await row()).visualBriefJson;
    answer = () => ({
      concept: "x",
      visualStyle: "NOPE",
      slides: [],
      differentiationFromSibling: "",
    });
    await expect(regenerateVisualBrief(ctx, { variantId })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    expect((await row()).visualBriefJson).toEqual(before);
  });

  it("refuses a variant that is not open for review and one without slides", async () => {
    await t.db
      .update(schema.contentVariants)
      .set({ status: "APPROVED" })
      .where(eq(schema.contentVariants.id, variantId));
    await expect(regenerateVisualBrief(ctx, { variantId })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await t.db
      .update(schema.contentVariants)
      .set({ status: "READY_FOR_REVIEW", slidesJson: [] })
      .where(eq(schema.contentVariants.id, variantId));
    await expect(regenerateVisualBrief(ctx, { variantId })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
  });
});
