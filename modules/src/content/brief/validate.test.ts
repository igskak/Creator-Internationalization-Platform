import { MarketBrief } from "@rc/db/json";
import { marketAdapter } from "@rc/prompts";
import { FIXTURE_INPUT, FIXTURE_OUTPUT } from "@rc/prompts/fixtures/market-adapter";
import { registry } from "@rc/templates";
import { describe, expect, it } from "vitest";
import { type BriefValidationContext, validateMarketBrief } from "./validate";

// The market adapter's plan checks (plan 07 §7.6.1, M2-09): pass and fail per rule.

const context = (over: Partial<BriefValidationContext> = {}): BriefValidationContext => ({
  ideaKnowledgeIds: new Set(["card-rice-1", "card-rice-2"]),
  primaryKnowledgeIds: new Set(["card-rice-1"]),
  templates: registry,
  hookTypes: new Set(FIXTURE_INPUT.taxonomy.hookTypes.map((t) => t.code)),
  ctaTypes: new Set(FIXTURE_INPUT.taxonomy.ctaTypes.map((t) => t.code)),
  market: {
    measurementSystem: "METRIC",
    forbiddenPatterns: [{ pattern: "\\bcamar[oó]n\\b", kind: "REGEX", reason: "LatAm term" }],
  },
  conversionDisplays: new Set(FIXTURE_INPUT.conversions.map((c) => c.display)),
  hasOffer: true,
  siblings: FIXTURE_INPUT.siblingPlans,
  ...over,
});
const brief = (patch: Partial<MarketBrief> = {}): MarketBrief => ({ ...FIXTURE_OUTPUT, ...patch });
const codes = (b: MarketBrief, c: BriefValidationContext = context()) =>
  validateMarketBrief(b, c).map((i) => i.code);
const plan = (...slides: [string, string, string[]?][]): MarketBrief["slidePlan"] =>
  slides.map(([role, templateId, ids]) => ({
    role: role as MarketBrief["slidePlan"][number]["role"],
    templateId: templateId as MarketBrief["slidePlan"][number]["templateId"],
    purpose: "p",
    knowledgeIds: ids ?? ["card-rice-1"],
  }));

describe("validateMarketBrief", () => {
  it("keeps the prompt's output shape equal to MarketBrief of @rc/db/json", () => {
    expect(MarketBrief.safeParse(FIXTURE_OUTPUT).success).toBe(true);
    expect(MarketBrief.safeParse({ ...FIXTURE_OUTPUT, hookType: "" }).success).toBe(false);
    expect(marketAdapter.MarketAdapterOutput.safeParse(FIXTURE_OUTPUT).success).toBe(true);
    expect(Object.keys(marketAdapter.MarketAdapterOutput.shape).sort()).toEqual(
      Object.keys(MarketBrief.shape).sort(),
    );
    expect(marketAdapter.SLIDE_ROLES).toEqual(
      MarketBrief.shape.slidePlan.element.shape.role.options,
    );
    expect(marketAdapter.TEMPLATE_IDS).toEqual(
      MarketBrief.shape.slidePlan.element.shape.templateId.options,
    );
  });

  it("passes the fixture plan", () => {
    expect(validateMarketBrief(FIXTURE_OUTPUT, context())).toEqual([]);
  });

  it("needs 5–10 slides", () => {
    const five = FIXTURE_OUTPUT.slidePlan;
    expect(codes(brief({ slidePlan: five.slice(0, 4) }))).toContain("SLIDE_COUNT");
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      ...five[1 + (i % 3)],
    })) as MarketBrief["slidePlan"];
    expect(codes(brief({ slidePlan: [five[0], ...eleven.slice(1), five[4]] as never }))).toContain(
      "SLIDE_COUNT",
    );
    const ten = [five[0], ...Array.from({ length: 8 }, () => five[1]), five[4]];
    expect(codes(brief({ slidePlan: ten as never }))).not.toContain("SLIDE_COUNT");
  });

  it("needs HOOK first and CTA last unless the CTA type is NONE", () => {
    const slides = FIXTURE_OUTPUT.slidePlan;
    expect(
      codes(brief({ slidePlan: [slides[1], slides[0], ...slides.slice(2)] as never })),
    ).toContain("FIRST_SLIDE_NOT_HOOK");
    const noCta = slides.slice(0, 4);
    const four = [...noCta, slides[3]] as never;
    expect(codes(brief({ slidePlan: four }))).toContain("LAST_SLIDE_NOT_CTA");
    expect(codes(brief({ slidePlan: four, ctaApproach: { ctaType: "NONE" } }))).not.toContain(
      "LAST_SLIDE_NOT_CTA",
    );
  });

  it("refuses an unknown template and a role the template cannot carry", () => {
    const slides = plan(
      ["HOOK", "A", []],
      ["MISTAKE", "Z", ["card-rice-1"]],
      ["FACT", "A"],
      ["FACT", "B"],
      ["CTA", "F", []],
    );
    const found = validateMarketBrief(brief({ slidePlan: slides }), context());
    expect(found.filter((i) => i.code === "TEMPLATE_UNKNOWN").map((i) => i.fieldPath)).toEqual([
      "slidePlan.1.templateId",
    ]);
    expect(
      found.filter((i) => i.code === "TEMPLATE_ROLE_MISMATCH").map((i) => i.fieldPath),
    ).toEqual(["slidePlan.2.templateId"]);
  });

  it("keeps card ids inside the idea and cites a card for every factual slide", () => {
    const slides = plan(
      ["HOOK", "A", []],
      ["FACT", "B", ["card-other"]],
      ["FACT", "B", []],
      ["SUMMARY", "B"],
      ["CTA", "F", []],
    );
    const found = codes(brief({ slidePlan: slides }));
    expect(found).toContain("CARD_NOT_IN_IDEA");
    expect(found).toContain("FACTUAL_SLIDE_UNCITED");
  });

  it("flags a plan that skips the primary cards, and a primary card left out", () => {
    const only2 = plan(
      ["HOOK", "A", []],
      ["FACT", "B", ["card-rice-2"]],
      ["EXPLANATION", "B", ["card-rice-2"]],
      ["SUMMARY", "B", ["card-rice-2"]],
      ["CTA", "F", []],
    );
    expect(codes(brief({ slidePlan: only2 }))).toContain("PRIMARY_NOT_COVERED");
    const partly = codes(
      brief(),
      context({ primaryKnowledgeIds: new Set(["card-rice-1", "card-rice-2"]) }),
    );
    expect(partly).not.toContain("PRIMARY_PARTLY_COVERED");
    const sev = validateMarketBrief(
      brief({ slidePlan: only2 }),
      context({ primaryKnowledgeIds: new Set(["card-rice-2", "card-rice-1"]) }),
    ).find((i) => i.code === "PRIMARY_PARTLY_COVERED");
    expect(sev?.severity).toBe("MAJOR");
  });

  it("knows only the taxonomy's hook and CTA types", () => {
    expect(codes(brief({ hookType: "BOLD_CLAIM" }))).toContain("HOOK_TYPE_UNKNOWN");
    expect(codes(brief({ ctaApproach: { ctaType: "LINK_IN_BIO" } }))).toContain("CTA_TYPE_UNKNOWN");
  });

  it("ties a keyword CTA to an offer and a valid keyword", () => {
    expect(codes(brief(), context({ hasOffer: false }))).toContain("CTA_NEEDS_OFFER");
    expect(codes(brief({ ctaApproach: { ctaType: "COMMENT_KEYWORD" } }))).toContain(
      "CTA_KEYWORD_MISSING",
    );
    expect(
      codes(
        brief({
          ctaApproach: { ctaType: "COMMENT_KEYWORD", keywordSuggestion: "arroz con leche" },
        }),
      ),
    ).toContain("CTA_KEYWORD_INVALID");
    expect(codes(brief({ ctaApproach: { ctaType: "SAVE" } }))).toEqual([]);
  });

  it("uses the market's unit system and only conversions of the table", () => {
    expect(codes(brief({ unitsPolicy: { system: "IMPERIAL", conversions: [] } }))).toContain(
      "UNITS_SYSTEM_MISMATCH",
    );
    const found = validateMarketBrief(
      brief({ unitsPolicy: { system: "METRIC", conversions: [{ from: "350 °F", to: "177 °C" }] } }),
      context(),
    );
    expect(found).toEqual([expect.objectContaining({ code: "CONVERSION_NOT_IN_TABLE" })]);
  });

  it("applies the market's forbidden patterns to local terms and examples", () => {
    const found = validateMarketBrief(
      brief({
        terminology: [{ concept: "shrimp", localTerm: "camarón", avoid: [] }],
        examples: ["ensalada de camarón"],
      }),
      context(),
    );
    expect(found.map((i) => [i.code, i.fieldPath])).toEqual([
      ["FORBIDDEN_PATTERN", "terminology.0.localTerm"],
      ["FORBIDDEN_PATTERN", "examples.0"],
    ]);
  });

  it("refuses a plan that repeats a sibling's hook type and structure, notes a shared hook type", () => {
    const sibling = FIXTURE_INPUT.siblingPlans[0];
    const copy = brief({
      hookType: "MYTH_BUST",
      slidePlan: sibling?.slidePlan.map((s) => ({ ...s, knowledgeIds: ["card-rice-1"] })) as never,
    });
    const found = validateMarketBrief(copy, context());
    expect(found.find((i) => i.code === "SAME_AS_SIBLING")?.severity).toBe("BLOCKER");

    const reordered = validateMarketBrief(brief({ hookType: "MYTH_BUST" }), context());
    expect(reordered.find((i) => i.code === "SAME_HOOK_TYPE")?.severity).toBe("MINOR");
    expect(reordered.map((i) => i.code)).not.toContain("SAME_AS_SIBLING");

    const sameStructureOtherHook = brief({ slidePlan: copy.slidePlan });
    expect(codes(sameStructureOtherHook)).not.toContain("SAME_AS_SIBLING");
  });
});
