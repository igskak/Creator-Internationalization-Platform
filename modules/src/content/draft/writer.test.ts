import { schema } from "@rc/db";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import type { contentWriter } from "@rc/prompts";
import { FIXTURE_INPUT, FIXTURE_OUTPUT } from "@rc/prompts/fixtures/content-writer";
import { registry } from "@rc/templates";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStage } from "../../ai";
import { createServiceContext, type ServiceContext } from "../../core";
import { isBlocking } from "../validation";
import { toDraftContent, validateWriterOutput, type WriterValidationContext } from "./validate";

type Output = contentWriter.ContentWriterOutput;

// The content writer through runStage with a fake model (M2-10) and the checks of its draft.

const context: WriterValidationContext = {
  locale: "es-ES",
  forbiddenPatterns: [{ pattern: "\\bcamar[oó]n\\b", kind: "REGEX", reason: "LatAm term" }],
  ideaKnowledgeIds: new Set(["card-rice-1", "card-rice-2"]),
  numericReference: {
    timings: [{ value: 18, valueMax: 20, unit: "min" }],
    texts: FIXTURE_INPUT.cards.map((c) => c.claim),
    textLocale: "ru",
  },
  templates: registry,
  brief: FIXTURE_INPUT.brief,
};

const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

/** The fixture with one slot text replaced. */
const withSlot = (slideIndex: number, slot: string, text: string): Output => ({
  ...FIXTURE_OUTPUT,
  slides: FIXTURE_OUTPUT.slides.map((s, i) =>
    i === slideIndex
      ? { ...s, slots: s.slots.map((x) => (x.slot === slot ? { ...x, text } : x)) }
      : s,
  ),
});

describe("writer fixture", () => {
  it("lists the slot limits of the real templates", () => {
    for (const template of FIXTURE_INPUT.templates) {
      const real = registry.get(template.id);
      expect(template.roles).toEqual(real?.roles);
      expect(template.textSlots).toEqual(
        Object.entries(real?.textSlots ?? {}).map(([name, s]) => ({
          name,
          maxChars: s.maxChars,
          maxLines: s.maxLines,
          required: s.required,
        })),
      );
    }
  });
});

describe("validateWriterOutput", () => {
  const codes = (output: Output) => validateWriterOutput(output, context).map((i) => i.code);

  it("turns slots into the stored shape", () => {
    const draft = toDraftContent(FIXTURE_OUTPUT);
    expect(draft.slides[1]).toMatchObject({
      id: "s2",
      index: 1,
      role: "MISTAKE",
      templateId: "E",
      slots: { mistakeTitle: "Error", correctTitle: "Mejor" },
      images: {},
      factual: true,
    });
    expect(draft.cta).toEqual({
      type: "COMMENT_KEYWORD",
      text: expect.any(String),
      keyword: "ARROZ",
    });
  });

  it("passes the fixture draft", () => {
    expect(validateWriterOutput(FIXTURE_OUTPUT, context)).toEqual([]);
  });

  it("blocks a slot over its limit and reports the path by slide index", () => {
    const issues = validateWriterOutput(withSlot(2, "body", "x".repeat(300)), context);
    const overflow = issues.find((i) => i.code === "SLOT_OVERFLOW");
    expect(overflow).toMatchObject({ severity: "BLOCKER", fieldPath: "slides.2.slots.body" });
  });

  it("blocks an uncited factual slide, a card outside the idea and a missing required slot", () => {
    const uncited: Output = {
      ...FIXTURE_OUTPUT,
      slides: FIXTURE_OUTPUT.slides.map((s, i) => (i === 3 ? { ...s, knowledgeIds: [] } : s)),
    };
    expect(codes(uncited)).toContain("FACTUAL_SLIDE_UNCITED");
    const foreign: Output = {
      ...FIXTURE_OUTPUT,
      slides: FIXTURE_OUTPUT.slides.map((s, i) =>
        i === 3 ? { ...s, knowledgeIds: ["other"] } : s,
      ),
    };
    expect(codes(foreign)).toContain("CITATION_NOT_IN_IDEA");
    const noBody: Output = {
      ...FIXTURE_OUTPUT,
      slides: FIXTURE_OUTPUT.slides.map((s, i) =>
        i === 2 ? { ...s, slots: s.slots.filter((x) => x.slot !== "body") } : s,
      ),
    };
    expect(validateWriterOutput(noBody, context).some(isBlocking)).toBe(true);
  });

  it("blocks a number that is not in the cards and a forbidden pattern", () => {
    expect(codes(withSlot(2, "body", "Cuécelo 45 minutos a fuego fuerte."))).toContain(
      "NUMERIC_MISMATCH",
    );
    expect(codes(withSlot(2, "body", "Como el camarón, pero con arroz."))).toContain(
      "FORBIDDEN_PATTERN",
    );
  });

  it("checks caption, hashtags and the CTA keyword", () => {
    expect(codes({ ...FIXTURE_OUTPUT, caption: "x".repeat(2300) })).toContain("CAPTION_TOO_LONG");
    expect(codes({ ...FIXTURE_OUTPUT, hashtags: ["#uno"] })).toContain("HASHTAG_COUNT");
    expect(
      codes({ ...FIXTURE_OUTPUT, cta: { ...FIXTURE_OUTPUT.cta, keyword: "arroz con leche" } }),
    ).toContain("CTA_KEYWORD_INVALID");
  });

  it("notes a deviation from the plan without blocking", () => {
    const shorter: Output = { ...FIXTURE_OUTPUT, slides: FIXTURE_OUTPUT.slides.slice(0, 4) };
    const plan = validateWriterOutput(shorter, context).find((i) => i.code === "PLAN_DEVIATION");
    expect(plan?.severity).toBe("MAJOR");
    const types = validateWriterOutput(
      { ...FIXTURE_OUTPUT, hookType: "CURIOSITY_GAP", cta: { type: "SAVE", text: "Guárdalo." } },
      context,
    );
    expect(types.filter((i) => i.severity === "MINOR").map((i) => i.code)).toEqual(
      expect.arrayContaining(["HOOK_TYPE_CHANGED", "CTA_TYPE_CHANGED"]),
    );
  });
});

describe("content writer stage", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let answers: unknown[];
  let prompts: string[];

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    answers = [];
    prompts = [];
    const llm = createFakeLLMProvider({
      handler: (request, call) => {
        prompts.push(JSON.stringify(request.messages));
        return answers[Math.min(call, answers.length - 1)];
      },
    });
    ctx = createServiceContext({ db: t.db, logger, llm, actor: { type: "SYSTEM" } });
  });
  afterEach(async () => {
    await t.close();
  });

  const run = () =>
    runStage<Output>(ctx, {
      stage: "CONTENT_WRITING",
      input: FIXTURE_INPUT,
      inputRefs: { knowledgeItemIds: ["card-rice-1", "card-rice-2"] },
      validate: (output) => validateWriterOutput(output, context),
    });

  it("accepts a good draft with one logged run", async () => {
    answers = [FIXTURE_OUTPUT];
    const result = await run();
    expect(result.status).toBe("SUCCEEDED");
    expect(result.data).toEqual(FIXTURE_OUTPUT);
    expect(await t.db.select().from(schema.generationRuns)).toEqual([
      expect.objectContaining({ stage: "CONTENT_WRITING", promptId: "content-writer" }),
    ]);
  });

  it("repairs once after a slot overflow, sending the issue with its field path", async () => {
    answers = [withSlot(2, "body", "x".repeat(300)), FIXTURE_OUTPUT];
    const result = await run();
    expect(result.status).toBe("REPAIRED");
    expect(result.data).toEqual(FIXTURE_OUTPUT);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("SLOT_OVERFLOW");
    expect(prompts[1]).toContain("slides.2.slots.body");
  });

  it("gives up when the draft is still over the limit after the repair", async () => {
    answers = [withSlot(2, "body", "x".repeat(300))];
    const result = await run();
    expect(result.status).toBe("INVALID_OUTPUT");
    expect(result.issues.map((i) => i.code)).toContain("SLOT_OVERFLOW");
  });

  it("does not repair for non-blocking notes alone", async () => {
    answers = [{ ...FIXTURE_OUTPUT, hookType: "CURIOSITY_GAP" }];
    const result = await run();
    expect(result.status).toBe("SUCCEEDED");
    expect(result.issues.map((i) => i.code)).toEqual(["HOOK_TYPE_CHANGED"]);
  });
});
