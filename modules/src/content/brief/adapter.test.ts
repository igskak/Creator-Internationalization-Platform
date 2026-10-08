import { schema } from "@rc/db";
import type { MarketBrief } from "@rc/db/json";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { FIXTURE_INPUT, FIXTURE_OUTPUT } from "@rc/prompts/fixtures/market-adapter";
import { registry } from "@rc/templates";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStage } from "../../ai";
import { createServiceContext, type ServiceContext } from "../../core";
import { type BriefValidationContext, validateMarketBrief } from "./validate";

// The market adapter through runStage with a fake model (M2-09): a good plan passes, a plan that
// breaks a rule is repaired once with the issue list, and a plan that stays broken is refused.

const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

const validation: BriefValidationContext = {
  ideaKnowledgeIds: new Set(["card-rice-1", "card-rice-2"]),
  primaryKnowledgeIds: new Set(["card-rice-1"]),
  templates: registry,
  hookTypes: new Set(FIXTURE_INPUT.taxonomy.hookTypes.map((t) => t.code)),
  ctaTypes: new Set(FIXTURE_INPUT.taxonomy.ctaTypes.map((t) => t.code)),
  market: { measurementSystem: "METRIC", forbiddenPatterns: [] },
  conversionDisplays: new Set(FIXTURE_INPUT.conversions.map((c) => c.display)),
  hasOffer: true,
  siblings: FIXTURE_INPUT.siblingPlans,
};

/** Valid for the prompt's schema, but the HOOK slide is second. */
const hookSecond: MarketBrief = {
  ...FIXTURE_OUTPUT,
  slidePlan: [
    FIXTURE_OUTPUT.slidePlan[1],
    FIXTURE_OUTPUT.slidePlan[0],
    ...FIXTURE_OUTPUT.slidePlan.slice(2),
  ] as MarketBrief["slidePlan"],
};

describe("market adapter stage", () => {
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
    runStage<MarketBrief>(ctx, {
      stage: "MARKET_ADAPTATION",
      input: FIXTURE_INPUT,
      inputRefs: { knowledgeItemIds: ["card-rice-1", "card-rice-2"] },
      validate: (output) => validateMarketBrief(output, validation),
    });

  it("accepts a good plan with one logged run", async () => {
    answers = [FIXTURE_OUTPUT];
    const result = await run();
    expect(result.status).toBe("SUCCEEDED");
    expect(result.data).toEqual(FIXTURE_OUTPUT);
    expect(await t.db.select().from(schema.generationRuns)).toEqual([
      expect.objectContaining({
        stage: "MARKET_ADAPTATION",
        promptId: "market-adapter",
        promptVersion: 1,
      }),
    ]);
  });

  it("repairs once, sending the issue list with the previous plan", async () => {
    answers = [hookSecond, FIXTURE_OUTPUT];
    const result = await run();
    expect(result.status).toBe("REPAIRED");
    expect(result.data).toEqual(FIXTURE_OUTPUT);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("FIRST_SLIDE_NOT_HOOK");
  });

  it("gives up after the repair when the plan is still broken", async () => {
    answers = [hookSecond];
    const result = await run();
    expect(result.status).toBe("INVALID_OUTPUT");
    expect(result.issues.map((i) => i.code)).toContain("FIRST_SLIDE_NOT_HOOK");
  });

  it("rejects a template or card the call did not offer before the validators run", async () => {
    answers = [
      {
        ...FIXTURE_OUTPUT,
        slidePlan: FIXTURE_OUTPUT.slidePlan.map((s) => ({ ...s, templateId: "C" })),
      },
    ];
    const result = await run();
    expect(result.status).toBe("INVALID_OUTPUT");
    expect(result.data).toBeNull();
  });
});
