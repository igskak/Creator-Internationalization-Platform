import type { CriticReport, ValidationIssue, VariantFlag } from "@rc/db/json";
import type { critic } from "@rc/prompts";
import { flagsForIssues, isBlocking } from "../validation";

// The deterministic verdict policy (plan 07 §7.6.3, M2-12). The critic model proposes a verdict
// and scores; this code decides, so a lenient or an over-strict model cannot let a draft with an
// unsupported claim through or send a good one round the loop forever.

type Output = critic.CriticAnswer;

/** A draft is rewritten at most this many times; what is left after that goes to a person. */
export const MAX_REWRITES = 2;

/** A hook scored this or lower is weak (critic@2, M2-12a). */
export const WEAK_HOOK_SCORE = 2;

/** Weights of the quality score (07 §7.6.3 rule 7); every other score counts once. */
export const SCORE_WEIGHTS: Record<keyof Output["scores"], number> = {
  hook: 1,
  factualFidelity: 2,
  localization: 1.5,
  sourceCoverage: 1,
  originality: 1,
  brandVoice: 1,
  structure: 1,
  cta: 1,
  overall: 1,
};

/** Weighted mean of the scores, 1–5, two decimals (`content_variants.quality_score`). */
export function qualityScore(scores: Output["scores"]): number {
  let sum = 0;
  let weights = 0;
  for (const [name, weight] of Object.entries(SCORE_WEIGHTS)) {
    const value = scores[name as keyof Output["scores"]];
    // critic@1 has no hook score: the mean is then over the other scores.
    if (value === undefined) continue;
    sum += value * weight;
    weights += weight;
  }
  return Math.round(Math.min(5, Math.max(1, sum / weights)) * 100) / 100;
}

export type PolicyInput = {
  /** The critic's answer, already checked by `validateCriticOutput`. */
  output: Output;
  /** What the validators of 07 §7.8 found in the draft being judged. */
  deterministicIssues: readonly ValidationIssue[];
  /** The comparison with the sibling variants; `later` is true when this variant is the one generated later. */
  differentiation?: { verdict: "OK" | "WARN" | "FAIL"; later: boolean };
  /** A card the draft cites is safety-sensitive. */
  citesSafetySensitive: boolean;
  /** How many rewrites this draft has had (0, 1 or 2). */
  rewritesDone: number;
};

export type PolicyDecision = {
  verdict: CriticReport["verdict"];
  /** Why, in words, for the log and the review screen. */
  reasons: string[];
  /** Flags for what is left unresolved (set on a final verdict only), plus SAFETY_REVIEW. */
  flags: VariantFlag[];
  qualityScore: number;
  /** For the writer, when the verdict is REQUEST_REWRITE. */
  rewriteInstructions: string;
  /** For the reviewer, when the verdict is FLAG_FOR_HUMAN. */
  humanAttention: string;
};

const DIFFERENTIATION_FIX = "Change the hook type and the slide structure; keep the facts.";

export function decideVerdict(input: PolicyInput): PolicyDecision {
  const { output, deterministicIssues, differentiation, rewritesDone } = input;
  const blockers = deterministicIssues.filter(isBlocking);
  const modelBlockers = output.issues.filter((i) => i.severity === "BLOCKER");
  const scores = Object.entries(output.scores) as [keyof Output["scores"], number][];
  const lowScores = scores.filter(
    ([name, value]) => name !== "overall" && name !== "hook" && value <= 2,
  );
  const hookFixes = hookInstructions(output);
  const weakHook = output.scores.hook !== undefined && output.scores.hook <= WEAK_HOOK_SCORE;

  // Rules 1–3: what needs a rewrite.
  const rewriteReasons: string[] = [];
  if (output.unsupportedClaims.length > 0) {
    rewriteReasons.push(`${output.unsupportedClaims.length} unsupported claim(s).`);
  }
  if (blockers.length > 0) {
    rewriteReasons.push(
      `Blocking validation issues: ${[...new Set(blockers.map((b) => b.code))].join(", ")}.`,
    );
  }
  if (modelBlockers.length > 0) {
    rewriteReasons.push(`${modelBlockers.length} blocking issue(s) found by the critic.`);
  }
  if (differentiation?.verdict === "FAIL" && differentiation.later) {
    rewriteReasons.push("Too similar to the sibling variant generated earlier.");
  }
  if (lowScores.length > 0 || output.scores.overall < 3) {
    const names = [
      ...lowScores.map(([name]) => name),
      ...(output.scores.overall < 3 ? ["overall"] : []),
    ];
    rewriteReasons.push(`Low score: ${names.join(", ")}.`);
  }

  // A weak hook asks for a rewrite only when the critic says how to fix it (M2-12a); without a
  // concrete instruction the writer would only be told "better", so a person looks instead.
  if (weakHook && hookFixes.length > 0) {
    rewriteReasons.push(`Weak hook (${output.scores.hook}/5).`);
  }

  const flags = new Set<VariantFlag>();
  if (input.citesSafetySensitive) flags.add("SAFETY_REVIEW");

  const score = qualityScore(output.scores);
  const base = { qualityScore: score };

  if (rewriteReasons.length > 0 && rewritesDone < MAX_REWRITES) {
    return {
      ...base,
      verdict: "REQUEST_REWRITE",
      reasons: rewriteReasons,
      flags: [...flags],
      rewriteInstructions: rewriteInstructions(input, rewriteReasons),
      humanAttention: "",
    };
  }

  // A final verdict: what is still wrong becomes a flag (rule 5).
  for (const flag of flagsForIssues(deterministicIssues)) flags.add(flag);
  if (output.unsupportedClaims.length > 0) flags.add("UNSUPPORTED_CLAIM");
  if (differentiation && differentiation.verdict !== "OK") flags.add("DUPLICATION_RISK");

  if (rewriteReasons.length > 0) {
    return {
      ...base,
      verdict: "FLAG_FOR_HUMAN",
      reasons: [`Still unresolved after ${rewritesDone} rewrites.`, ...rewriteReasons],
      flags: [...flags],
      rewriteInstructions: "",
      humanAttention: humanAttention(input, [
        `Still unresolved after ${rewritesDone} rewrites.`,
        ...rewriteReasons,
      ]),
    };
  }
  if (weakHook && hookFixes.length === 0) {
    return {
      ...base,
      verdict: "FLAG_FOR_HUMAN",
      reasons: [`Weak hook (${output.scores.hook}/5) without a concrete fix.`],
      flags: [...flags],
      rewriteInstructions: "",
      humanAttention: humanAttention(input, [
        `The hook is weak (${output.scores.hook}/5) and the critic gave no concrete fix; read it.`,
      ]),
    };
  }
  // Rule 4: the critic is unsure.
  if (output.verdict === "FLAG_FOR_HUMAN") {
    return {
      ...base,
      verdict: "FLAG_FOR_HUMAN",
      reasons: ["The critic asks for a person to look."],
      flags: [...flags],
      rewriteInstructions: "",
      humanAttention:
        output.humanAttention.trim() || "The critic could not decide; read the draft.",
    };
  }
  return {
    ...base,
    verdict: "PASS",
    reasons: [],
    flags: [...flags],
    rewriteInstructions: "",
    humanAttention: "",
  };
}

/** Hook issues of the critic that carry a replacement or a concrete instruction. */
function hookInstructions(output: Output): string[] {
  return output.issues
    .filter((i) => i.category === "HOOK" && i.suggestedFix.trim())
    .map((i) => `hook: ${i.suggestedFix.trim()}`);
}

function rewriteInstructions(input: PolicyInput, reasons: readonly string[]): string {
  const { output, deterministicIssues, differentiation } = input;
  const lines: string[] = [];
  if (output.rewriteInstructions.trim()) lines.push(output.rewriteInstructions.trim());
  for (const claim of output.unsupportedClaims) {
    lines.push(`${claim.fieldPath}: remove or rewrite "${claim.text}" (${claim.reason})`);
  }
  for (const issue of deterministicIssues.filter(isBlocking)) {
    lines.push(`${issue.fieldPath ?? "draft"}: ${issue.fixHint ?? issue.message}`);
  }
  for (const issue of output.issues.filter((i) => i.severity === "BLOCKER")) {
    lines.push(`${issue.fieldPath || "draft"}: ${issue.suggestedFix.trim() || issue.explanation}`);
  }
  if (output.scores.hook !== undefined && output.scores.hook <= WEAK_HOOK_SCORE) {
    for (const fix of hookInstructions(output)) {
      if (!lines.includes(fix)) lines.push(fix);
    }
  }
  if (differentiation?.verdict === "FAIL" && differentiation.later) lines.push(DIFFERENTIATION_FIX);
  // A rewrite that only a low score asks for still gets the critic's fixes for its weaker findings.
  for (const issue of output.issues.filter(
    (i) => i.severity === "MAJOR" && i.suggestedFix.trim(),
  )) {
    lines.push(`${issue.fieldPath || "draft"}: ${issue.suggestedFix.trim()}`);
  }
  if (lines.length === 0) lines.push(...reasons);
  return lines.map((l) => `- ${l}`).join("\n");
}

function humanAttention(input: PolicyInput, reasons: readonly string[]): string {
  const modelNote = input.output.humanAttention.trim();
  return [...(modelNote ? [modelNote] : []), ...reasons].join(" ");
}

/** The `CriticReport` stored on the variant: the model's findings with the policy's verdict. */
export function buildCriticReport(
  output: Output,
  decision: PolicyDecision,
  deterministicIssues: readonly ValidationIssue[],
  iteration: number,
): CriticReport {
  return {
    verdict: decision.verdict,
    iteration,
    scores: output.scores,
    unsupportedClaims: output.unsupportedClaims,
    issues: output.issues.map(({ fieldPath, suggestedFix, ...issue }) => ({
      ...issue,
      ...(fieldPath ? { fieldPath } : {}),
      ...(suggestedFix.trim() ? { suggestedFix } : {}),
    })),
    ...(decision.rewriteInstructions ? { rewriteInstructions: decision.rewriteInstructions } : {}),
    ...(decision.humanAttention ? { humanAttention: decision.humanAttention } : {}),
    deterministicIssues: [...deterministicIssues],
  };
}
