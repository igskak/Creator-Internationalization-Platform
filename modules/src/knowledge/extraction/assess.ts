import type { knowledgeExtractor } from "@rc/prompts";
import { safetyReasons } from "./safety";
import { verifyNumbers, verifyQuote } from "./verify-quote";

/** Review flags set on cards (04 §4.3 `review_flags`). */
export const REVIEW_FLAGS = [
  "QUOTE_UNVERIFIED",
  "LOW_CONFIDENCE",
  "DUPLICATE_SUSPECTED",
  "SAFETY_SENSITIVE",
] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export type CardAssessment = {
  quoteVerified: boolean;
  matchScore: number;
  flags: ReviewFlag[];
  /** Why the flags were set, for `source_reference.note`. */
  notes: string[];
  safetySensitive: boolean;
  safetyNotes: string | null;
};

/**
 * The deterministic checks of 07 §7.2.4 and §7.2.7 for one extracted card: quote against the cited
 * pages ± 1, numbers against the cited pages, confidence, and food-safety flags.
 */
export function assessCard(
  card: knowledgeExtractor.KnowledgeCardDraft,
  pages: readonly { pageNumber: number; text: string }[],
): CardAssessment {
  const cited = { pageStart: card.pageStart, pageEnd: card.pageEnd };
  const flags = new Set<ReviewFlag>();
  const notes: string[] = [];

  const quote = verifyQuote(card.sourceQuote, pages, cited);
  if (!quote.verified) {
    flags.add("QUOTE_UNVERIFIED");
    notes.push(`quote not found in the cited pages (best match ${quote.score.toFixed(2)})`);
  }
  const numbers = verifyNumbers(card, pages, cited);
  if (numbers.missing.length > 0) {
    flags.add("LOW_CONFIDENCE");
    notes.push(`number not found in source: ${numbers.missing.join(", ")}`);
  }
  if (card.confidence < LOW_CONFIDENCE_THRESHOLD) {
    flags.add("LOW_CONFIDENCE");
    notes.push(`model confidence ${card.confidence.toFixed(2)}`);
  }

  const text = [
    card.title,
    card.claim,
    card.explanation,
    card.sourceQuote,
    ...card.procedure.map((s) => s.text),
    ...card.commonMistakes.flatMap((m) => [m.mistake, m.why ?? "", m.fix ?? ""]),
    ...card.temperatures.map((t) => t.context),
    ...card.timings.map((t) => t.context),
  ].join("\n");
  const reasons = safetyReasons(text);
  if (card.temperatures.some((t) => t.target === "CORE")) reasons.push("core temperature");
  const safetySensitive = card.safetySensitive || reasons.length > 0;
  if (safetySensitive) flags.add("SAFETY_SENSITIVE");
  const safetyNotes = safetySensitive
    ? card.safetyReason?.trim() || `Keyword rule: ${[...new Set(reasons)].join("; ")}`
    : null;
  if (!card.safetySensitive && reasons.length > 0) {
    notes.push(`safety keywords: ${[...new Set(reasons)].join("; ")}`);
  }

  return {
    quoteVerified: quote.verified,
    matchScore: quote.score,
    flags: [...flags],
    notes,
    safetySensitive,
    safetyNotes,
  };
}
