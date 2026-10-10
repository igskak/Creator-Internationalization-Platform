import type { ValidationIssue } from "@rc/db/json";
import type { critic } from "@rc/prompts";
import { FIXTURE_OUTPUT as PASS } from "@rc/prompts/fixtures/critic";
import { describe, expect, it } from "vitest";
import {
  buildCriticReport,
  decideVerdict,
  MAX_REWRITES,
  type PolicyInput,
  qualityScore,
} from "./policy";

// The verdict policy of 07 §7.6.3: one table row per rule, then the combinations. Synthetic data.

type Output = critic.CriticAnswer;
const scores = (over: Partial<Output["scores"]> = {}): Output["scores"] => ({
  ...PASS.scores,
  ...over,
});
const out = (over: Partial<Output> = {}): Output => ({ ...PASS, issues: [], ...over });
const blocker: ValidationIssue = {
  code: "SLOT_OVERFLOW",
  severity: "BLOCKER",
  fieldPath: "slides.2.slots.body",
  message: "Too long.",
  fixHint: "Shorten the body to 220 characters.",
};
const numeric: ValidationIssue = { ...blocker, code: "NUMERIC_MISMATCH", fieldPath: "caption" };
const major: ValidationIssue = {
  code: "HASHTAG_COUNT",
  severity: "MAJOR",
  fieldPath: "hashtags",
  message: "2 hashtags.",
};
const claim = {
  fieldPath: "slides.3.slots.body",
  text: "Cures colds.",
  reason: "No card says it.",
};

const input = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  output: out(),
  deterministicIssues: [],
  citesSafetySensitive: false,
  rewritesDone: 0,
  ...over,
});

describe("qualityScore (rule 7)", () => {
  it("is the weighted mean: factual fidelity × 2, localization × 1.5, the rest × 1", () => {
    const all = (n: number) =>
      scores(Object.fromEntries(Object.keys(PASS.scores).map((k) => [k, n])));
    expect(qualityScore(all(3))).toBe(3);
    expect(qualityScore(all(5))).toBe(5);
    expect(qualityScore(all(1))).toBe(1);
    // (5×2 + 1×1.5 + 7×3) / 10.5
    expect(
      qualityScore(
        scores({
          factualFidelity: 5,
          localization: 1,
          sourceCoverage: 3,
          originality: 3,
          brandVoice: 3,
          structure: 3,
          cta: 3,
          hook: 3,
          overall: 3,
        }),
      ),
    ).toBe(3.1);
  });

  it("stays within 1–5 even for scores out of range", () => {
    expect(qualityScore(scores({ factualFidelity: 9, localization: 9 }))).toBeLessThanOrEqual(5);
    expect(qualityScore(scores({ factualFidelity: -3 }))).toBeGreaterThanOrEqual(1);
  });
});

describe("decideVerdict", () => {
  it("passes a clean review with its quality score", () => {
    const d = decideVerdict(input());
    expect(d).toMatchObject({
      verdict: "PASS",
      reasons: [],
      flags: [],
      rewriteInstructions: "",
      humanAttention: "",
    });
    expect(d.qualityScore).toBe(qualityScore(PASS.scores));
  });

  const rewriteCases: [string, Partial<PolicyInput>][] = [
    ["1. an unsupported claim", { output: out({ unsupportedClaims: [claim] }) }],
    ["1. a blocking validation issue", { deterministicIssues: [blocker] }],
    [
      "1. a blocking issue of the critic",
      {
        output: out({
          issues: [
            {
              severity: "BLOCKER",
              category: "SAFETY",
              fieldPath: "slides.1",
              explanation: "Wrong temperature advice.",
              suggestedFix: "Use the card's value.",
            },
          ],
        }),
      },
    ],
    [
      "2. differentiation FAIL for the later market",
      { differentiation: { verdict: "FAIL", later: true } },
    ],
    ["3. a score of 2", { output: out({ scores: scores({ localization: 2 }) }) }],
    ["3. overall below 3", { output: out({ scores: scores({ overall: 2.5 }) }) }],
  ];
  it.each(rewriteCases)("requests a rewrite for %s", (_name, over) => {
    const d = decideVerdict(input(over));
    expect(d.verdict).toBe("REQUEST_REWRITE");
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.rewriteInstructions).not.toBe("");
  });

  it("does not rewrite for a score of 3, a MAJOR validation issue or differentiation WARN", () => {
    const d = decideVerdict(
      input({
        output: out({ scores: scores({ brandVoice: 3 }) }),
        deterministicIssues: [major],
        differentiation: { verdict: "WARN", later: true },
      }),
    );
    expect(d.verdict).toBe("PASS");
    expect(d.flags).toContain("DUPLICATION_RISK");
  });

  it("asks the earlier market of a failing pair for nothing, but flags the risk", () => {
    const d = decideVerdict(input({ differentiation: { verdict: "FAIL", later: false } }));
    expect(d.verdict).toBe("PASS");
    expect(d.flags).toEqual(["DUPLICATION_RISK"]);
  });

  it("(rule 2) tells the later market to change hook type and structure, keeping the facts", () => {
    const d = decideVerdict(input({ differentiation: { verdict: "FAIL", later: true } }));
    expect(d.rewriteInstructions).toContain(
      "Change the hook type and the slide structure; keep the facts.",
    );
  });

  it("(rule 4) flags for a person when the critic is unsure and nothing needs a rewrite", () => {
    const d = decideVerdict(
      input({
        output: out({ verdict: "FLAG_FOR_HUMAN", humanAttention: "Card 2 contradicts card 1." }),
      }),
    );
    expect(d).toMatchObject({
      verdict: "FLAG_FOR_HUMAN",
      humanAttention: "Card 2 contradicts card 1.",
    });
  });

  it("(rule 4) a rewrite still comes first while rewrites remain", () => {
    const d = decideVerdict(
      input({
        output: out({
          verdict: "FLAG_FOR_HUMAN",
          humanAttention: "Unsure.",
          unsupportedClaims: [claim],
        }),
      }),
    );
    expect(d.verdict).toBe("REQUEST_REWRITE");
  });

  it("ignores a model REQUEST_REWRITE that no rule backs", () => {
    const d = decideVerdict(
      input({ output: out({ verdict: "REQUEST_REWRITE", rewriteInstructions: "Polish." }) }),
    );
    expect(d.verdict).toBe("PASS");
  });

  describe("(rule 5) after the last rewrite", () => {
    const last = { rewritesDone: MAX_REWRITES };

    it("sends what is still wrong to a person, with the matching flags", () => {
      const d = decideVerdict(
        input({
          ...last,
          output: out({ unsupportedClaims: [claim] }),
          deterministicIssues: [numeric],
          differentiation: { verdict: "FAIL", later: true },
        }),
      );
      expect(d.verdict).toBe("FLAG_FOR_HUMAN");
      expect(d.flags).toEqual(
        expect.arrayContaining(["UNSUPPORTED_CLAIM", "NUMERIC_MISMATCH", "DUPLICATION_RISK"]),
      );
      expect(d.reasons[0]).toBe("Still unresolved after 2 rewrites.");
      expect(d.humanAttention).toContain("unsupported claim");
      expect(d.rewriteInstructions).toBe("");
    });

    it("turns a blocking slot overflow into the TEXT_OVERFLOW flag", () => {
      const d = decideVerdict(input({ ...last, deterministicIssues: [blocker] }));
      expect(d.verdict).toBe("FLAG_FOR_HUMAN");
      expect(d.flags).toContain("TEXT_OVERFLOW");
    });

    it("still passes a clean draft, and one rewrite short of the limit still rewrites", () => {
      expect(decideVerdict(input(last)).verdict).toBe("PASS");
      expect(
        decideVerdict(input({ rewritesDone: MAX_REWRITES - 1, deterministicIssues: [blocker] }))
          .verdict,
      ).toBe("REQUEST_REWRITE");
    });

    it("keeps the model's note for the person", () => {
      const d = decideVerdict(
        input({
          ...last,
          output: out({
            unsupportedClaims: [claim],
            humanAttention: "Check the claim with the chef.",
          }),
        }),
      );
      expect(d.humanAttention).toMatch(/^Check the claim with the chef\./);
    });
  });

  describe("(rule 6) safety", () => {
    it("adds SAFETY_REVIEW to any verdict without changing it", () => {
      expect(decideVerdict(input({ citesSafetySensitive: true }))).toMatchObject({
        verdict: "PASS",
        flags: ["SAFETY_REVIEW"],
      });
      expect(
        decideVerdict(input({ citesSafetySensitive: true, deterministicIssues: [blocker] })),
      ).toMatchObject({ verdict: "REQUEST_REWRITE", flags: ["SAFETY_REVIEW"] });
    });
  });

  it("collects the instructions from the critic, the claims, the validators and the plan", () => {
    const d = decideVerdict(
      input({
        output: out({ rewriteInstructions: "Open with the mistake.", unsupportedClaims: [claim] }),
        deterministicIssues: [blocker, major],
        differentiation: { verdict: "FAIL", later: true },
      }),
    );
    expect(d.rewriteInstructions.split("\n")).toEqual([
      "- Open with the mistake.",
      '- slides.3.slots.body: remove or rewrite "Cures colds." (No card says it.)',
      "- slides.2.slots.body: Shorten the body to 220 characters.",
      "- Change the hook type and the slide structure; keep the facts.",
    ]);
  });

  it("(rule 3) a low score alone still gets instructions: the critic's fixes, or the reasons", () => {
    const withFix = decideVerdict(
      input({
        output: out({
          scores: scores({ localization: 2 }),
          issues: [
            {
              severity: "MAJOR",
              category: "LOCALIZATION",
              fieldPath: "slides.2.slots.body",
              explanation: "Translationese.",
              suggestedFix: "Say it as a Spanish cook would.",
            },
          ],
        }),
      }),
    );
    expect(withFix.rewriteInstructions).toBe(
      "- slides.2.slots.body: Say it as a Spanish cook would.",
    );
    const bare = decideVerdict(input({ output: out({ scores: scores({ overall: 2 }) }) }));
    expect(bare.rewriteInstructions).toBe("- Low score: overall.");
  });

  it("does not set flags on a rewrite request other than SAFETY_REVIEW", () => {
    const d = decideVerdict(
      input({ deterministicIssues: [numeric], output: out({ unsupportedClaims: [claim] }) }),
    );
    expect(d.flags).toEqual([]);
  });
});

describe("buildCriticReport", () => {
  it("stores the policy's verdict with the model's findings and the deterministic issues", () => {
    const output = out({
      verdict: "PASS",
      unsupportedClaims: [claim],
      issues: [
        {
          severity: "MAJOR",
          category: "FACTUAL",
          fieldPath: "slides.3.slots.body",
          explanation: "x",
          suggestedFix: "",
        },
        {
          severity: "MINOR",
          category: "OTHER",
          fieldPath: "",
          explanation: "y",
          suggestedFix: "Z",
        },
      ],
    });
    const decision = decideVerdict(input({ output, deterministicIssues: [blocker] }));
    const report = buildCriticReport(output, decision, [blocker], 1);
    expect(report).toMatchObject({
      verdict: "REQUEST_REWRITE",
      iteration: 1,
      deterministicIssues: [blocker],
      rewriteInstructions: expect.stringContaining("Cures colds."),
    });
    expect(report.humanAttention).toBeUndefined();
    expect(report.issues).toEqual([
      {
        severity: "MAJOR",
        category: "FACTUAL",
        fieldPath: "slides.3.slots.body",
        explanation: "x",
      },
      { severity: "MINOR", category: "OTHER", explanation: "y", suggestedFix: "Z" },
    ]);
  });
});

describe("weak hook (critic@2, M2-12a)", () => {
  const weak = (fix: string) =>
    out({
      scores: scores({ hook: 2 }),
      issues: [
        {
          severity: "MAJOR",
          category: "HOOK",
          fieldPath: "hook",
          explanation: "A general statement, not a hook.",
          suggestedFix: fix,
        },
      ],
    });

  it("asks a rewrite for a weak hook that comes with a concrete fix, and passes the fix on", () => {
    const d = decideVerdict(
      input({ output: weak("Open with the myth: “Pasta water needs oil”.") }),
    );
    expect(d.verdict).toBe("REQUEST_REWRITE");
    expect(d.reasons).toContain("Weak hook (2/5).");
    expect(d.rewriteInstructions).toContain("hook: Open with the myth");
    // A weak hook alone is not a "low score" of the other rule.
    expect(d.reasons.filter((r) => r.startsWith("Low score"))).toEqual([]);
  });

  it("does not ask a rewrite without a concrete instruction: a person looks", () => {
    const d = decideVerdict(input({ output: weak("  ") }));
    expect(d.verdict).toBe("FLAG_FOR_HUMAN");
    expect(d.rewriteInstructions).toBe("");
    expect(d.humanAttention).toContain("hook is weak");
  });

  it("lets a hook of 3 pass and ignores a missing hook score (critic@1)", () => {
    expect(decideVerdict(input({ output: out({ scores: scores({ hook: 3 }) }) })).verdict).toBe(
      "PASS",
    );
    const { hook: _hook, ...v1Scores } = scores();
    expect(decideVerdict(input({ output: out({ scores: v1Scores }) })).verdict).toBe("PASS");
    expect(qualityScore(v1Scores)).toBe(
      qualityScore({ ...v1Scores, hook: qualityScore(v1Scores) }),
    );
  });

  it("flags a weak hook that is still there after the last rewrite", () => {
    const d = decideVerdict(
      input({ output: weak("Open with the myth."), rewritesDone: MAX_REWRITES }),
    );
    expect(d.verdict).toBe("FLAG_FOR_HUMAN");
    expect(d.reasons).toContain("Weak hook (2/5).");
  });

  it("weighs the hook in the quality score", () => {
    expect(qualityScore(scores({ hook: 1 }))).toBeLessThan(qualityScore(scores({ hook: 5 })));
  });
});
