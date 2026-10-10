import { schema } from "@rc/db";
import type { CriticReport, Slide } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeLLMProvider, type StructuredRequest } from "@rc/lib/providers/llm";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, manualClock, type ServiceContext } from "../core";
import { runVisualQa } from "./visual-qa";

// The vision check with a scripted model and in-memory storage. Synthetic content only.

const slide = (id: string, index: number, templateId: string, role: string): Slide => ({
  id,
  index,
  role: role as Slide["role"],
  templateId: templateId as Slide["templateId"],
  slots: { headline: `Texto ${id}` },
  images: {},
  knowledgeIds: [],
  factual: false,
});
const report = (): CriticReport => ({
  verdict: "PASS",
  iteration: 0,
  scores: {
    factualFidelity: 5,
    sourceCoverage: 4,
    localization: 4,
    originality: 5,
    brandVoice: 4,
    structure: 5,
    cta: 4,
    overall: 4,
  },
  unsupportedClaims: [],
  issues: [
    { severity: "MINOR", category: "LOCALIZATION", fieldPath: "hook", explanation: "Polish." },
  ],
  deterministicIssues: [],
});

describe("runVisualQa", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let storage: ReturnType<typeof createMemoryStorage>;
  let llm: ReturnType<typeof createFakeLLMProvider>;
  let variantId: string;
  let answer: (request: StructuredRequest<unknown>) => unknown;

  const variant = async () => {
    const [v] = await t.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variantId));
    return v as typeof schema.contentVariants.$inferSelect;
  };

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    storage = createMemoryStorage();
    answer = () => ({
      issues: [
        {
          slideId: "s1",
          severity: "MAJOR",
          category: "LEGIBILITY",
          explanation: "Headline over a bright rim.",
          suggestedFix: "Regenerate the picture.",
        },
        {
          slideId: "s2",
          severity: "MINOR",
          category: "AI_ARTIFACT",
          explanation: "Odd grain.",
          suggestedFix: "",
        },
      ],
    });
    llm = createFakeLLMProvider({ handler: (request) => answer(request) });
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
      storage,
      actor: { type: "SYSTEM" },
    });
    const [brand] = await t.db.select().from(schema.brands);
    const [idea] = await t.db
      .insert(schema.masterIdeas)
      .values({
        brandId: brand?.id ?? "",
        topic: "Rice",
        category: "GRAINS_RICE_PASTA",
        angle: "COMMON_MISTAKE",
        coreMessage: "Do not rinse risotto rice.",
        status: "ACCEPTED",
        origin: "MANUAL",
      })
      .returning();
    const [market] = await t.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.code, "es-ES"));
    const slides = [
      slide("s1", 0, "A", "HOOK"),
      slide("s2", 1, "B", "FACT"),
      slide("s3", 2, "F", "CTA"),
    ];
    const [row] = await t.db
      .insert(schema.contentVariants)
      .values({
        masterIdeaId: idea?.id ?? "",
        marketId: market?.id ?? "",
        status: "READY_FOR_REVIEW",
        slidesJson: slides,
        criticReport: report(),
      })
      .returning();
    variantId = row?.id ?? "";
    const [render] = await t.db
      .insert(schema.carouselRenders)
      .values({
        contentVariantId: variantId,
        inputHash: "h",
        status: "READY",
        templatesVersion: "t",
      })
      .returning();
    for (const [i, s] of slides.entries()) {
      const key = `renders/${variantId}/${render?.id}/${i}.jpg`;
      await storage.put(key, new Uint8Array([0xff, 0xd8, i]), { contentType: "image/jpeg" });
      await t.db.insert(schema.renderedSlides).values({
        carouselRenderId: render?.id ?? "",
        slideIndex: i,
        slideId: s.id,
        templateId: s.templateId,
        storageKey: key,
        width: 1080,
        height: 1350,
        bytes: 3,
        sha256: "x",
      });
    }
    await t.db
      .update(schema.contentVariants)
      .set({ currentRenderId: render?.id ?? null })
      .where(eq(schema.contentVariants.id, variantId));
  });

  afterEach(async () => {
    await t.close();
  });

  it("sends the slides as images in order and adds the findings to the critic report", async () => {
    const result = await runVisualQa(ctx, { variantId });
    expect(result).toMatchObject({
      checked: ["s1", "s2", "s3"],
      skipped: [],
      issues: 2,
      reported: true,
    });
    const request = llm.calls[0] as StructuredRequest<unknown>;
    const content = request.messages[0]?.content ?? [];
    expect(content.filter((c) => c.type === "image")).toHaveLength(3);
    expect(content.at(-1)?.type).toBe("text");
    expect(request.meta).toMatchObject({ stage: "VISUAL_QA", promptId: "visual-qa" });

    const issues = (await variant()).criticReport?.issues ?? [];
    expect(issues.map((i) => i.category)).toEqual([
      "LOCALIZATION",
      "VISUAL_LEGIBILITY",
      "VISUAL_AI_ARTIFACT",
    ]);
    expect(issues[1]).toMatchObject({
      severity: "MAJOR",
      fieldPath: "slides.s1",
      suggestedFix: "Regenerate the picture.",
    });
    expect(issues[2]?.suggestedFix).toBeUndefined();
    expect((await t.db.select().from(schema.auditEvents)).map((a) => a.action)).toContain(
      "variant.visual_qa",
    );
    expect((await t.db.select().from(schema.generationRuns))[0]?.contentVariantId).toBe(variantId);
  });

  it("replaces the previous visual findings and keeps the others", async () => {
    await runVisualQa(ctx, { variantId });
    answer = () => ({ issues: [] });
    await runVisualQa(ctx, { variantId });
    expect(((await variant()).criticReport?.issues ?? []).map((i) => i.category)).toEqual([
      "LOCALIZATION",
    ]);
  });

  it("leaves out a slide with a library photo that may not go to a model", async () => {
    const [brand] = await t.db.select().from(schema.brands);
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId: brand?.id ?? "",
        type: "PHOTO",
        title: "Rice",
        originalLanguage: "ru",
        rights: {
          use: "ALLOWED",
          translate: "ALLOWED",
          adapt: "ALLOWED",
          visuallyTransform: "ALLOWED",
          sell: "UNKNOWN",
          aiProcessing: "DENIED",
          improvePrompts: "DENIED",
        },
      })
      .returning();
    const [photo] = await t.db
      .insert(schema.visualAssets)
      .values({
        brandId: brand?.id ?? "",
        kind: "LIBRARY_PHOTO",
        status: "READY",
        sourceAssetId: source?.id ?? null,
        storageKey: "library/p.webp",
      })
      .returning();
    const slides = structuredClone((await variant()).slidesJson);
    (slides[1] as Slide).images = { side: { assetId: photo?.id ?? "" } };
    await t.db
      .update(schema.contentVariants)
      .set({ slidesJson: slides })
      .where(eq(schema.contentVariants.id, variantId));
    answer = () => ({ issues: [] });

    const result = await runVisualQa(ctx, { variantId });
    expect(result).toMatchObject({ checked: ["s1", "s3"], skipped: ["s2"] });
    const request = llm.calls[0] as StructuredRequest<unknown>;
    expect((request.messages[0]?.content ?? []).filter((c) => c.type === "image")).toHaveLength(2);
    expect(JSON.stringify(request.messages)).not.toContain('id="s2"');
  });

  it("calls no model when every slide is left out", async () => {
    const [brand] = await t.db.select().from(schema.brands);
    const [photo] = await t.db
      .insert(schema.visualAssets)
      .values({
        brandId: brand?.id ?? "",
        kind: "LIBRARY_PHOTO",
        status: "READY",
        storageKey: "library/orphan.webp",
      })
      .returning();
    const slides = structuredClone((await variant()).slidesJson).map((s) => ({
      ...s,
      images: { x: { assetId: photo?.id ?? "" } },
    }));
    await t.db
      .update(schema.contentVariants)
      .set({ slidesJson: slides })
      .where(eq(schema.contentVariants.id, variantId));
    const result = await runVisualQa(ctx, { variantId });
    expect(result).toMatchObject({ checked: [], skipped: ["s1", "s2", "s3"], issues: 0 });
    expect(llm.calls).toHaveLength(0);
  });

  it("repairs an answer that names a slide that is not there, and fails if it stays wrong", async () => {
    answer = () => ({
      issues: [
        {
          slideId: "zz",
          severity: "MAJOR",
          category: "LEGIBILITY",
          explanation: "x",
          suggestedFix: "",
        },
      ],
    });
    await expect(runVisualQa(ctx, { variantId })).rejects.toBeInstanceOf(InvalidStateError);
    expect(((await variant()).criticReport?.issues ?? []).map((i) => i.category)).toEqual([
      "LOCALIZATION",
    ]);
  });

  it("reports that there is no critic report to add to, without failing", async () => {
    await t.db
      .update(schema.contentVariants)
      .set({ criticReport: null })
      .where(eq(schema.contentVariants.id, variantId));
    expect(await runVisualQa(ctx, { variantId })).toMatchObject({ issues: 2, reported: false });
  });

  it("needs a ready render and an open variant", async () => {
    await t.db
      .update(schema.contentVariants)
      .set({ currentRenderId: null })
      .where(eq(schema.contentVariants.id, variantId));
    await expect(runVisualQa(ctx, { variantId })).rejects.toThrow("no render");
    await t.db
      .update(schema.contentVariants)
      .set({ status: "APPROVED" })
      .where(eq(schema.contentVariants.id, variantId));
    await expect(runVisualQa(ctx, { variantId })).rejects.toBeInstanceOf(InvalidStateError);
  });
});
