import { CriticReport } from "@rc/db/json";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import type { critic } from "@rc/prompts";
import { FIXTURE_INPUT, FIXTURE_OUTPUT } from "@rc/prompts/fixtures/critic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStage } from "../../ai";
import { createServiceContext, type ServiceContext } from "../../core";
import { buildCriticReport, decideVerdict } from "./policy";
import { draftFieldPaths, validateCriticOutput } from "./validate-critic";

type Output = critic.CriticAnswer;

// The critic through runStage with a fake model, then the policy (M2-12).

const codes = (output: Output) =>
  validateCriticOutput(output, FIXTURE_INPUT.draft).map((i) => `${i.severity}:${i.code}`);

describe("validateCriticOutput", () => {
  it("passes the fixture review", () => {
    expect(codes(FIXTURE_OUTPUT)).toEqual([]);
  });

  it("knows the paths printed in the draft", () => {
    const paths = draftFieldPaths(FIXTURE_INPUT.draft);
    for (const path of [
      "hook",
      "slides.0",
      "slides.2.slots.body",
      "caption",
      "cta",
      "hashtags.2",
      "claimsUsed.1",
    ]) {
      expect(paths.has(path)).toBe(true);
    }
    expect(paths.has("slides.9")).toBe(false);
    expect(paths.has("hashtags.3")).toBe(false);
  });

  it("blocks scores outside 1–5", () => {
    expect(codes({ ...FIXTURE_OUTPUT, scores: { ...FIXTURE_OUTPUT.scores, overall: 7 } })).toEqual([
      "BLOCKER:SCORE_OUT_OF_RANGE",
    ]);
    expect(codes({ ...FIXTURE_OUTPUT, scores: { ...FIXTURE_OUTPUT.scores, cta: 0 } })).toEqual([
      "BLOCKER:SCORE_OUT_OF_RANGE",
    ]);
  });

  it("blocks a REQUEST_REWRITE without instructions and a FLAG_FOR_HUMAN without a note", () => {
    expect(codes({ ...FIXTURE_OUTPUT, verdict: "REQUEST_REWRITE" })).toEqual([
      "BLOCKER:REWRITE_WITHOUT_INSTRUCTIONS",
    ]);
    expect(codes({ ...FIXTURE_OUTPUT, verdict: "FLAG_FOR_HUMAN" })).toEqual([
      "BLOCKER:FLAG_WITHOUT_ATTENTION",
    ]);
    expect(
      codes({
        ...FIXTURE_OUTPUT,
        verdict: "REQUEST_REWRITE",
        rewriteInstructions: "Shorten slide 3.",
      }),
    ).toEqual([]);
  });

  it("notes a PASS that lists unsupported claims, and blocks an unknown claim path", () => {
    const claim = { fieldPath: "slides.2.slots.body", text: "x", reason: "y" };
    expect(codes({ ...FIXTURE_OUTPUT, unsupportedClaims: [claim] })).toEqual([
      "MAJOR:PASS_WITH_UNSUPPORTED_CLAIMS",
    ]);
    expect(
      codes({
        ...FIXTURE_OUTPUT,
        verdict: "REQUEST_REWRITE",
        rewriteInstructions: "Fix.",
        unsupportedClaims: [{ ...claim, fieldPath: "slides.7.slots.body" }],
      }),
    ).toEqual(["BLOCKER:FIELD_PATH_UNKNOWN"]);
  });

  it("only notes an unknown path of an ordinary issue and allows an empty one", () => {
    const issue = FIXTURE_OUTPUT.issues[0];
    if (!issue) throw new Error("fixture");
    expect(codes({ ...FIXTURE_OUTPUT, issues: [{ ...issue, fieldPath: "slides.7" }] })).toEqual([
      "MINOR:FIELD_PATH_UNKNOWN",
    ]);
    expect(codes({ ...FIXTURE_OUTPUT, issues: [{ ...issue, fieldPath: "" }] })).toEqual([]);
  });
});

describe("critic stage with a fake model", () => {
  const logger = createLogger({
    service: "jobs",
    env: "test",
    level: "fatal",
    destination: { write: () => {} },
  });
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
      stage: "CRITIC",
      input: FIXTURE_INPUT,
      inputRefs: { knowledgeItemIds: FIXTURE_INPUT.cards.map((c) => c.id) },
      validate: (output) => validateCriticOutput(output, FIXTURE_INPUT.draft),
    });

  it("passes a good review through the policy to a stored CriticReport", async () => {
    answers = [FIXTURE_OUTPUT];
    const result = await run();
    expect(result.status).toBe("SUCCEEDED");
    const output = result.data as Output;
    const decision = decideVerdict({
      output,
      deterministicIssues: FIXTURE_INPUT.deterministicIssues.map((i) => ({ ...i })),
      citesSafetySensitive: false,
      rewritesDone: 0,
    });
    expect(decision.verdict).toBe("PASS");
    const report = buildCriticReport(output, decision, [], 0);
    expect(CriticReport.safeParse(report).success).toBe(true);
  });

  it("makes a REQUEST_REWRITE out of a review that lists an unsupported claim", async () => {
    answers = [
      {
        ...FIXTURE_OUTPUT,
        verdict: "REQUEST_REWRITE",
        scores: { ...FIXTURE_OUTPUT.scores, factualFidelity: 2 },
        unsupportedClaims: [
          {
            fieldPath: "slides.3.slots.body",
            text: "Dos partes de agua.",
            reason: "Only for long-grain rice.",
          },
        ],
        rewriteInstructions: "Say it is for long-grain rice.",
      },
    ];
    const result = await run();
    const decision = decideVerdict({
      output: result.data as Output,
      deterministicIssues: [],
      citesSafetySensitive: false,
      rewritesDone: 0,
    });
    expect(decision.verdict).toBe("REQUEST_REWRITE");
    expect(decision.rewriteInstructions).toContain("long-grain rice");
  });

  it("repairs once when the review is incoherent, sending the issue", async () => {
    answers = [
      { ...FIXTURE_OUTPUT, verdict: "REQUEST_REWRITE", rewriteInstructions: "" },
      { ...FIXTURE_OUTPUT, verdict: "REQUEST_REWRITE", rewriteInstructions: "Shorten slide 3." },
    ];
    const result = await run();
    expect(result.status).toBe("REPAIRED");
    expect(prompts[1]).toContain("REWRITE_WITHOUT_INSTRUCTIONS");
  });

  it("is INVALID_OUTPUT when the scores stay out of range", async () => {
    answers = [{ ...FIXTURE_OUTPUT, scores: { ...FIXTURE_OUTPUT.scores, overall: 11 } }];
    const result = await run();
    expect(result.status).toBe("INVALID_OUTPUT");
    expect(result.issues.map((i) => i.code)).toContain("SCORE_OUT_OF_RANGE");
  });
});
