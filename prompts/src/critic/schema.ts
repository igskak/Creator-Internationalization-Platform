import { z } from "zod";
import { ContentWriterOutput } from "../content-writer/schema";
import { MarketAdapterOutput } from "../market-adapter/schema";

// Input and output of the critic (plan 07 §7.6.1, §7.6.4, §7.7, M2-12). The output is the
// `CriticReport` of `@rc/db/json` without `iteration` and `deterministicIssues` (code adds them);
// the verdict is a proposal: the deterministic policy of M2-12 decides (07 §7.6.3).

export const CRITIC_VERDICTS = ["PASS", "REQUEST_REWRITE", "FLAG_FOR_HUMAN"] as const;
export const ISSUE_SEVERITIES = ["BLOCKER", "MAJOR", "MINOR"] as const;
export const ISSUE_CATEGORIES = [
  "FACTUAL",
  "COVERAGE",
  "LOCALIZATION",
  "ORIGINALITY",
  "BRAND_VOICE",
  "STRUCTURE",
  "CTA",
  "SAFETY",
  "OTHER",
] as const;
export const SCORE_NAMES = [
  "factualFidelity",
  "sourceCoverage",
  "localization",
  "originality",
  "brandVoice",
  "structure",
  "cta",
  "overall",
] as const;

const Card = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  language: z.string().min(1),
  role: z.enum(["PRIMARY", "SUPPORTING"]),
  title: z.string(),
  claim: z.string(),
  explanation: z.string().default(""),
  procedure: z.array(z.object({ n: z.number().int(), text: z.string() })).default([]),
  safetySensitive: z.boolean().default(false),
  safetyNotes: z.string().nullish(),
});

export const CriticInput = z.object({
  brandVoice: z.string(),
  idea: z.object({ topic: z.string(), coreMessage: z.string() }),
  cards: z.array(Card).min(1),
  market: z.object({
    code: z.string().min(1),
    displayName: z.string(),
    language: z.string().min(1),
    toneNotes: z.string(),
    foodCultureNotes: z.string(),
    preferredVocabulary: z.array(
      z.object({
        concept: z.string(),
        preferred: z.string(),
        avoid: z.array(z.string()).default([]),
      }),
    ),
  }),
  /** The plan the draft was written from. */
  brief: MarketAdapterOutput,
  /** The draft under review. */
  draft: ContentWriterOutput,
  /** Hook and gist of the other markets' drafts. */
  siblingSummary: z
    .array(z.object({ marketCode: z.string().min(1), hook: z.string(), gist: z.string() }))
    .default([]),
  /** What the code checks already (07 §7.8): the critic does not repeat it, it complements it. */
  deterministicIssues: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(ISSUE_SEVERITIES),
      fieldPath: z.string().optional(),
      message: z.string(),
    }),
  ),
  /** The comparison with the sibling variants, when there are siblings. */
  differentiation: z
    .object({
      verdict: z.enum(["OK", "WARN", "FAIL"]),
      hookSimilarity: z.number(),
      slideTextSimilarity: z.number(),
      reasons: z.array(z.string()),
    })
    .optional(),
  /** 0 for the first review; 1 and 2 after a rewrite. */
  iteration: z.number().int().min(0).max(2),
});
export type CriticInput = z.infer<typeof CriticInput>;

/** `CriticReport` of `@rc/db/json` without `iteration` and `deterministicIssues`. */
export const CriticOutput = z.object({
  verdict: z.enum(CRITIC_VERDICTS),
  /** 1–5 each; the range is checked by the validators, not by the schema. */
  scores: z.object({
    factualFidelity: z.number(),
    sourceCoverage: z.number(),
    localization: z.number(),
    originality: z.number(),
    brandVoice: z.number(),
    structure: z.number(),
    cta: z.number(),
    overall: z.number(),
  }),
  unsupportedClaims: z.array(
    z.object({ fieldPath: z.string(), text: z.string(), reason: z.string() }),
  ),
  issues: z.array(
    z.object({
      severity: z.enum(ISSUE_SEVERITIES),
      category: z.enum(ISSUE_CATEGORIES),
      fieldPath: z.string(),
      explanation: z.string(),
      suggestedFix: z.string(),
    }),
  ),
  /** Concrete instructions for the writer; empty when the verdict is PASS. */
  rewriteInstructions: z.string(),
  /** What a person must look at; empty unless the verdict is FLAG_FOR_HUMAN. */
  humanAttention: z.string(),
});
export type CriticOutput = z.infer<typeof CriticOutput>;

/** Schema for one call: the structural one (nothing in it depends on the input). */
export function criticOutputFor(_input: CriticInput): z.ZodType<CriticOutput> {
  return CriticOutput;
}
