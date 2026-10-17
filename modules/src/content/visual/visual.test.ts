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
import { recordingJobs } from "../variants/test-support";
import { recipeOf } from "./inputs";
import {
  finishPhotoPrompts,
  PHOTO_NEGATIVE,
  PHOTO_NEGATIVE_WHOLE,
  PHOTO_STYLE,
  PHOTO_STYLE_WHOLE,
  PLACEMENT_COMPOSITION,
  photoNegative,
  photoPrompt,
  SLOT_COMPOSITION,
  SPLIT_COMPOSITION,
  WHOLE_COMPOSITION,
} from "./photo-prompt";
import {
  regenerateVisualBrief,
  requestVisualsRegeneration,
  runVisualsRegeneration,
} from "./regenerate";
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
    const optional = entry({ slideId: "s2", slot: "side", aspect: "4:5" });
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

  it("gives the director the idea's recipe and finishes the prompts of a shot list", async () => {
    let request = "";
    answer = (text) => {
      request = text;
      const scripted = scriptedVisualBrief(text) as VisualBrief;
      const shots = ["TECHNIQUE_IN_ACTION", "INGREDIENT_MACRO", "FINISHED_DISH"] as const;
      return {
        ...scripted,
        slides: scripted.slides.map((e, i) => ({
          ...e,
          source: "GENERATE",
          shotType: shots[i],
          prompt: `Subject ${i + 1}`,
          negativePrompt: "burnt grains",
        })),
      };
    };
    const { visualBrief } = await regenerateVisualBrief(ctx, { variantId });
    expect(request).toContain("<recipe>");
    expect(request).toContain("Рис не промывают.");
    const side = visualBrief.slides.find((e) => e.slot === "side");
    expect(side?.prompt).toBe(`Subject 2. ${SLOT_COMPOSITION.side} ${PHOTO_STYLE}`);
    expect(side?.negativePrompt).toBe(`${PHOTO_NEGATIVE}, burnt grains`);
    const hero = visualBrief.slides.find((e) => e.slot === "hero");
    expect(hero?.prompt).toContain(SLOT_COMPOSITION.cover);
    expect((await row()).visualBriefJson).toEqual(visualBrief);
  });

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

  it("offers the library photos whose rights allow it, and lets the director pick one", async () => {
    const [brand] = await t.db.select().from(schema.brands);
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId: brand?.id ?? "",
        type: "PHOTO",
        title: "Rice bowl",
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
        description: "A bowl of rice on slate",
        tags: ["rice"],
      })
      .returning();
    const photoId = photo?.id ?? "";
    let seen = "";
    answer = (text) => {
      seen = text;
      const brief = scriptedVisualBrief(text);
      // The director chooses the library photo for the first slot.
      return {
        ...brief,
        slides: brief.slides.map((e, i) =>
          i === 0
            ? {
                slideId: e.slideId,
                slot: e.slot,
                source: "LIBRARY",
                libraryAssetId: photoId,
                composition: "Library photo.",
                aspect: e.aspect,
              }
            : e,
        ),
      };
    };
    const { visualBrief } = await regenerateVisualBrief(ctx, { variantId });
    expect(seen).toContain(`<photo id="${photoId}"`);
    expect(seen).toContain("A bowl of rice on slate");
    expect(visualBrief.slides[0]).toMatchObject({ source: "LIBRARY", libraryAssetId: photoId });

    // A photo whose source forbids the transform is not offered, and picking it is refused.
    await t.db
      .update(schema.sourceAssets)
      .set({ rights: { ...source?.rights, visuallyTransform: "UNKNOWN" } as never })
      .where(eq(schema.sourceAssets.id, source?.id ?? ""));
    await expect(regenerateVisualBrief(ctx, { variantId })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    expect(seen).not.toContain(`<photo id="${photoId}"`);
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

  describe("regenerate pictures (J22)", () => {
    const withJobs = () => {
      const recorder = recordingJobs();
      return { jobs: recorder.calls, ctx: { ...ctx, jobs: recorder.runner } };
    };

    it("queues the job without touching the variant", async () => {
      const { jobs, ctx: c } = withJobs();
      const { requestId } = await requestVisualsRegeneration(c, { variantId });
      expect(jobs).toEqual([
        {
          name: "regenerate-visuals",
          payload: { variantId, requestId },
          options: { idempotencyKey: `regen-visuals:${requestId}` },
        },
      ]);
      const v = await row();
      expect(v.visualBriefJson).toBeNull();
      expect(v.lockVersion).toBe(0);
      const audits = await t.db.select().from(schema.auditEvents);
      expect(audits.map((a) => a.action)).toContain("variant.visuals_regeneration_requested");
    });

    it("refuses an approved variant and one without slides", async () => {
      const { jobs, ctx: c } = withJobs();
      await t.db
        .update(schema.contentVariants)
        .set({ status: "APPROVED" })
        .where(eq(schema.contentVariants.id, variantId));
      await expect(requestVisualsRegeneration(c, { variantId })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      await t.db
        .update(schema.contentVariants)
        .set({ status: "CHANGES_REQUESTED", slidesJson: [] })
        .where(eq(schema.contentVariants.id, variantId));
      await expect(requestVisualsRegeneration(c, { variantId })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      expect(jobs).toEqual([]);
    });

    it("replans the pictures, keeps the text and queues the drawing", async () => {
      const { jobs, ctx: c } = withJobs();
      const requestId = "00000000-0000-4000-8000-000000000001";
      const result = await runVisualsRegeneration(c, { variantId, requestId });
      const v = await row();
      expect(v.visualBriefJson?.slides).toHaveLength(result.slots);
      expect(v.slidesJson).toEqual(slides);
      expect(jobs).toEqual([
        {
          name: "generate-visual-assets",
          payload: { variantId },
          options: { idempotencyKey: `regen-visuals-assets:${requestId}` },
        },
      ]);
    });

    it("draws nothing when the new plan is not usable", async () => {
      const { jobs, ctx: c } = withJobs();
      answer = () => ({
        concept: "x",
        visualStyle: "NOPE",
        slides: [],
        differentiationFromSibling: "",
      });
      await expect(
        runVisualsRegeneration(c, { variantId, requestId: "00000000-0000-4000-8000-000000000002" }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      expect(jobs).toEqual([]);
    });
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

describe("photo prompts", () => {
  it("adds the slot's composition and the style to the director's subject, once", () => {
    const side = photoPrompt("Water running through quinoa in a strainer", "side");
    expect(side).toBe(
      `Water running through quinoa in a strainer. ${SLOT_COMPOSITION.side} ${PHOTO_STYLE}`,
    );
    expect(photoPrompt(side, "side")).toBe(side);
    expect(photoPrompt("A bowl of quinoa!", "centred")).toBe(
      `A bowl of quinoa! ${SLOT_COMPOSITION.centred} ${PHOTO_STYLE}`,
    );
  });

  it("splits the frame of a comparison, in the slot's place", () => {
    expect(photoPrompt("Raw and toasted quinoa", "side", true)).toBe(
      `Raw and toasted quinoa. ${SPLIT_COMPOSITION.side} ${PHOTO_STYLE}`,
    );
    const finished = finishPhotoPrompts(
      brief({
        slides: [
          entry({
            slideId: "s2",
            slot: "side",
            aspect: "4:5",
            shotType: "COMPARISON",
            prompt: "Wet | fluffy",
          }),
        ],
      }),
      slides,
      p0Registry,
    );
    expect(finished.slides[0]?.prompt).toContain(SPLIT_COMPOSITION.side);
  });

  it("composes an inner picture for its placement; the corner and other slots keep theirs", () => {
    expect(photoPrompt("Three spoons", "side", false, "RIGHT_COLUMN")).toBe(
      `Three spoons. ${PLACEMENT_COMPOSITION.RIGHT_COLUMN} ${PHOTO_STYLE}`,
    );
    expect(photoPrompt("Two mounds", "side", true, "TOP_RIGHT")).toContain(
      PLACEMENT_COMPOSITION.TOP_RIGHT,
    );
    expect(photoPrompt("A pot", "side", true, "CORNER")).toContain(SPLIT_COMPOSITION.side);
    expect(photoPrompt("A bowl", "cover", false, "BOTTOM_BAND")).toContain(SLOT_COMPOSITION.cover);
    expect(photoPrompt("A bowl", "side", false, "SIDEWAYS")).toContain(SLOT_COMPOSITION.side);
  });

  it("keeps the fixed negative list and adds the director's own terms without repeats", () => {
    expect(photoNegative(undefined)).toBe(PHOTO_NEGATIVE);
    const merged = photoNegative("burnt grains, Text, oil splatter");
    expect(merged).toBe(`${PHOTO_NEGATIVE}, burnt grains, oil splatter`);
    expect(photoNegative(merged)).toBe(merged);
  });

  it("finishes only the generated pictures of a shot list, by template slot", () => {
    const finished = finishPhotoPrompts(
      brief({
        slides: [
          entry({ shotType: "FINISHED_DISH", prompt: "A bowl of quinoa" }),
          entry({ slideId: "s2", slot: "side", aspect: "4:5", prompt: "Old full prompt" }),
        ],
      }),
      slides,
      p0Registry,
    );
    expect(finished.slides[0]?.prompt).toContain(SLOT_COMPOSITION.cover);
    expect(finished.slides[1]?.prompt).toBe("Old full prompt");
    expect(finished.slides[1]?.negativePrompt).toBe("text");
  });
});

describe("shot list checks", () => {
  const five = [
    slide("s1", 0, "A", "HOOK"),
    slide("s2", 1, "B", "STEP"),
    slide("s3", 2, "B", "STEP"),
    slide("s4", 3, "B", "FACT"),
    slide("s5", 4, "F", "CTA"),
  ];
  const ctx5: VisualValidationContext = { ...context, slides: five };
  const shot = (
    slideId: string,
    shotType: NonNullable<VisualBrief["slides"][number]["shotType"]>,
  ) =>
    entry({
      slideId,
      slot: slideId === "s1" ? "hero" : slideId === "s5" ? "product" : "side",
      aspect: "4:5",
      shotType,
    });
  const codesOf = (shots: VisualBrief["slides"]) =>
    validateVisualBrief(brief({ slides: shots }), ctx5).map((i) => i.code);

  it("accepts a varied shot list", () => {
    expect(
      codesOf([
        shot("s1", "FINISHED_DISH"),
        shot("s2", "TECHNIQUE_IN_ACTION"),
        shot("s3", "IN_THE_VESSEL"),
        shot("s4", "COMPARISON"),
        shot("s5", "FINISHED_DISH"),
      ]),
    ).toEqual([]);
  });

  it("blocks the same shot on neighbouring slides, in slide order", () => {
    const issues = validateVisualBrief(
      brief({
        slides: [
          shot("s3", "INGREDIENT_MACRO"),
          shot("s1", "FINISHED_DISH"),
          shot("s2", "INGREDIENT_MACRO"),
        ],
      }),
      ctx5,
    );
    expect(issues).toEqual([
      expect.objectContaining({ code: "VISUAL_SHOT_REPEATED", severity: "BLOCKER" }),
    ]);
  });

  it("blocks more than two pictures of the food in its pot", () => {
    expect(
      codesOf([
        shot("s1", "IN_THE_VESSEL"),
        shot("s2", "TECHNIQUE_IN_ACTION"),
        shot("s3", "IN_THE_VESSEL"),
        shot("s4", "COMPARISON"),
        shot("s5", "IN_THE_VESSEL"),
      ]),
    ).toEqual(["VISUAL_SHOT_VESSEL"]);
  });

  it("blocks a long carousel that uses only two kinds of shot", () => {
    expect(
      codesOf([
        shot("s1", "FINISHED_DISH"),
        shot("s2", "INGREDIENT_MACRO"),
        shot("s3", "FINISHED_DISH"),
        shot("s4", "INGREDIENT_MACRO"),
      ]),
    ).toEqual(["VISUAL_SHOT_MONOTONOUS"]);
  });

  it("does not check briefs without shot types (older directors)", () => {
    expect(codesOf([entry(), entry({ slideId: "s2", slot: "side", aspect: "4:5" })])).toEqual([]);
  });
});

describe("recipeOf", () => {
  it("turns the cards into steps in order, ingredient lines and mistakes with their fix", () => {
    expect(
      recipeOf([
        {
          id: "k1",
          title: "Quinoa",
          claim: "Rinse it.",
          procedure: [
            { n: 2, text: "Toast it in oil." },
            { n: 1, text: "Rinse it in a fine-mesh strainer." },
          ],
          ingredients: [
            { name: "quinoa", quantity: 200, unit: "g", note: "rinsed" },
            { name: "olive oil" },
          ],
          commonMistakes: [
            { mistake: "Straight from the bag", fix: "Rinse first" },
            { mistake: "Too much water" },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "k1",
        title: "Quinoa",
        claim: "Rinse it.",
        steps: ["Rinse it in a fine-mesh strainer.", "Toast it in oil."],
        ingredients: ["200 g quinoa (rinsed)", "olive oil"],
        mistakes: ["Straight from the bag → Rinse first", "Too much water"],
      },
    ]);
  });
});

describe("colour checks", () => {
  const four = [
    slide("s1", 0, "A", "HOOK"),
    slide("s2", 1, "B", "STEP"),
    slide("s3", 2, "B", "FACT"),
    slide("s4", 3, "F", "CTA"),
  ];
  const ctx4: VisualValidationContext = { ...context, slides: four };
  const pic = (
    slideId: string,
    shotType: NonNullable<VisualBrief["slides"][number]["shotType"]>,
    colorAccent: string,
    colorSource?: "RECIPE" | "SERVING",
  ) =>
    entry({
      slideId,
      slot: slideId === "s1" ? "hero" : slideId === "s4" ? "product" : "side",
      aspect: "4:5",
      shotType,
      colorAccent,
      ...(colorSource ? { colorSource } : {}),
    });
  const codesOf = (pics: VisualBrief["slides"]) =>
    validateVisualBrief(brief({ slides: pics }), ctx4).map((i) => i.code);

  it("accepts half of the pictures with a colour accent, serving ones on the cover and the dish", () => {
    expect(
      codesOf([
        pic("s1", "TECHNIQUE_IN_ACTION", "chopped parsley", "SERVING"),
        pic("s2", "TOOL_AND_INGREDIENT", ""),
        pic("s3", "INGREDIENT_MACRO", ""),
        pic("s4", "FINISHED_DISH", "black cast-iron skillet", "RECIPE"),
      ]),
    ).toEqual([]);
  });

  it("blocks a carousel with too few colour accents", () => {
    expect(
      codesOf([
        pic("s1", "TECHNIQUE_IN_ACTION", "golden crust", "RECIPE"),
        pic("s2", "TOOL_AND_INGREDIENT", ""),
        pic("s3", "INGREDIENT_MACRO", ""),
        pic("s4", "FINISHED_DISH", ""),
      ]),
    ).toEqual(["VISUAL_COLOUR_MISSING"]);
  });

  it("blocks a serving suggestion on a step picture, and notes a missing source", () => {
    expect(
      codesOf([
        pic("s1", "TECHNIQUE_IN_ACTION", "golden crust", "RECIPE"),
        pic("s2", "TOOL_AND_INGREDIENT", "cherry tomatoes", "SERVING"),
        pic("s3", "INGREDIENT_MACRO", "green peas"),
        pic("s4", "FINISHED_DISH", ""),
      ]),
    ).toEqual(["VISUAL_COLOUR_SERVING", "VISUAL_COLOUR_SOURCE"]);
  });

  it("does not check briefs without colour fields (older directors)", () => {
    expect(
      codesOf([
        entry({ shotType: "FINISHED_DISH" }),
        entry({ slideId: "s2", slot: "side", aspect: "4:5", shotType: "INGREDIENT_MACRO" }),
      ]),
    ).toEqual([]);
  });
});

describe("placement checks", () => {
  const withText = (id: string, index: number, body: string): Slide => ({
    ...slide(id, index, "B", "STEP"),
    slots: { headline: "A headline that does not count", body },
  });
  const slides4 = [
    withText("s2", 0, "Short body."),
    withText("s3", 1, "x".repeat(200)),
    withText("s4", 2, "Short **body**."),
  ];
  const ctx: VisualValidationContext = { ...context, slides: slides4 };
  const at = (slideId: string, placement: string) =>
    entry({ slideId, slot: "side", aspect: "4:5", placement });
  const codesOf = (pics: VisualBrief["slides"]) =>
    validateVisualBrief(brief({ slides: pics }), ctx).map((i) => i.code);

  it("accepts varied placements and a bottom band on a short slide", () => {
    expect(
      codesOf([at("s2", "BOTTOM_BAND"), at("s3", "RIGHT_COLUMN"), at("s4", "BOTTOM_BAND")]),
    ).toEqual([]);
  });

  it("blocks the same placement on neighbouring slides only", () => {
    expect(codesOf([at("s2", "CORNER"), at("s3", "CORNER")])).toEqual([
      "VISUAL_PLACEMENT_REPEATED",
    ]);
    expect(codesOf([at("s2", "CORNER"), at("s4", "CORNER")])).toEqual([]);
  });

  it("blocks a bottom band under a long text", () => {
    expect(codesOf([at("s3", "BOTTOM_BAND")])).toEqual(["VISUAL_PLACEMENT_BAND"]);
  });
});

describe("whole subjects (visual-director@7)", () => {
  it("composes a whole subject for its placement, two servings for a comparison in the corner", () => {
    expect(photoPrompt("A spoon lifts rice", "side", false, "TOP_RIGHT", true)).toBe(
      `A spoon lifts rice. ${WHOLE_COMPOSITION.TOP_RIGHT} ${PHOTO_STYLE_WHOLE}`,
    );
    expect(photoPrompt("Wet and fluffy rice", "side", true, "CORNER", true)).toContain(
      WHOLE_COMPOSITION.PAIR,
    );
    expect(photoPrompt("Three bowls", "side", true, "RIGHT_COLUMN", true)).toContain(
      WHOLE_COMPOSITION.RIGHT_COLUMN,
    );
    expect(photoPrompt("A served bowl", "cover", false, undefined, true)).toBe(
      `A served bowl. ${SLOT_COMPOSITION.cover} ${PHOTO_STYLE_WHOLE}`,
    );
    const done = photoPrompt("A bowl", "side", false, "CORNER", true);
    expect(photoPrompt(done, "side", false, "CORNER", true)).toBe(done);
    expect(photoNegative("mushy clumps", true)).toBe(`${PHOTO_NEGATIVE_WHOLE}, mushy clumps`);
  });

  it("finishes a brief that names a vessel with the whole-subject composition", () => {
    const finished = finishPhotoPrompts(
      brief({
        slides: [
          entry({
            slideId: "s2",
            slot: "side",
            shotType: "COMPARISON",
            vessel: "WHITE_PORCELAIN",
            prompt: "Wet rice and fluffy rice on two white plates",
          }),
        ],
      }),
      slides,
      p0Registry,
    );
    expect(finished.slides[0]?.prompt).toContain(WHOLE_COMPOSITION.PAIR);
    expect(finished.slides[0]?.prompt).not.toContain(SPLIT_COMPOSITION.side);
    expect(finished.slides[0]?.negativePrompt).toContain("split frame");
  });
});

describe("moment checks (visual-director@7)", () => {
  const step = (id: string, index: number, body: string): Slide => ({
    ...slide(id, index, "B", "STEP"),
    slots: { headline: "Rinse the rice", body },
  });
  const steps = [
    step("m1", 0, "Rinse it **three or four times** in cold water."),
    step("m2", 1, "Spread the grains on a wide warm skillet."),
    step("m3", 2, "Leave the lid on for ten minutes off the heat."),
    step("m4", 3, "Fluff with a fork and serve."),
    step("m5", 4, "Measure 240 ml of rice and 330 ml of water."),
    step("m6", 5, "Bring it to a calm simmer, then turn the heat down."),
  ];
  const ctx: VisualValidationContext = { ...context, slides: steps };
  const pic = (
    slideId: string,
    over: Partial<VisualBrief["slides"][number]> = {},
  ): VisualBrief["slides"][number] =>
    entry({
      slideId,
      slot: "side",
      shotType: "TECHNIQUE_IN_ACTION",
      vessel: "WHITE_PORCELAIN",
      arrangement: "HERO",
      depicts: "three or four times",
      ...over,
    });
  const codesOf = (pics: VisualBrief["slides"]) =>
    validateVisualBrief(brief({ slides: pics }), ctx)
      .map((i) => i.code)
      .filter((c) => !c.startsWith("VISUAL_SHOT") && c !== "VISUAL_COLOUR_MISSING");

  it("accepts pictures that quote their slide, vary and use one dark vessel", () => {
    expect(
      codesOf([
        pic("m1"),
        pic("m2", { depicts: "wide warm skillet", vessel: "STEEL", arrangement: "TOOL_IN_ACTION" }),
        pic("m3", {
          depicts: "Leave the lid on",
          vessel: "CAST_IRON",
          arrangement: "HERO_WITH_DEPTH",
        }),
      ]),
    ).toEqual([]);
  });

  it("blocks a missing or invented depicts", () => {
    expect(codesOf([pic("m1", { depicts: "" })])).toEqual(["VISUAL_DEPICTS_MISSING"]);
    expect(codesOf([pic("m2", { depicts: "a deep pot of boiling pasta" })])).toEqual([
      "VISUAL_DEPICTS_NOT_IN_SLIDE",
    ]);
  });

  it("blocks a second dark vessel and the same picture twice", () => {
    expect(
      codesOf([
        pic("m1", { vessel: "CAST_IRON" }),
        pic("m2", {
          depicts: "wide warm skillet",
          vessel: "DARK_CERAMIC",
          arrangement: "SEQUENCE",
        }),
      ]),
    ).toEqual(["VISUAL_VESSEL_DARK"]);
    expect(codesOf([pic("m1"), pic("m3", { depicts: "Leave the lid on" })])).toEqual([
      "VISUAL_PICTURE_REPEATED",
    ]);
  });

  it("asks six pictures for four arrangements", () => {
    const six = steps.map((s, i) =>
      pic(s.id, {
        depicts: Object.values(s.slots).join(" ").split(" ").slice(0, 3).join(" "),
        arrangement: i % 2 ? "HERO" : "SEQUENCE",
        vessel: (["WHITE_PORCELAIN", "STEEL", "GLASS"] as const)[i % 3],
        shotType: (["TECHNIQUE_IN_ACTION", "FINISHED_DISH", "INGREDIENT_MACRO"] as const)[i % 3],
      }),
    );
    expect(codesOf(six)).toEqual(["VISUAL_ARRANGEMENT_MONOTONOUS"]);
  });

  it("does not check briefs without a vessel (older directors)", () => {
    expect(codesOf([pic("m1", { vessel: undefined, depicts: undefined })])).toEqual([]);
  });
});
