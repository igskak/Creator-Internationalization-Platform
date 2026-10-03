import {
  CommonMistakeList,
  IngredientList,
  ProcedureList,
  TemperatureList,
  TimingList,
  type ValidationIssue,
} from "@rc/db/json";
import type { knowledgeExtractor } from "@rc/prompts";

// Domain validation of an extractor answer (plan 07 §7.8 layer 2–3), run by runStage: BLOCKER
// issues trigger the one repair, the rest are kept as reviewer information. Quote and number
// verification against the page text is M1-14.

type Output = knowledgeExtractor.ExtractorOutput;

export const MAX_QUOTE_CHARS = 400;

export function validateExtraction(
  output: Output,
  range: { pageStart: number; pageEnd: number },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const blocker = (code: string, fieldPath: string, message: string, fixHint?: string) =>
    issues.push({ code, severity: "BLOCKER", fieldPath, message, ...(fixHint ? { fixHint } : {}) });
  const inRange = (page: number) => page >= range.pageStart && page <= range.pageEnd;

  output.cards.forEach((card, i) => {
    const at = (field: string) => `cards.${i}.${field}`;
    if (!card.title.trim()) blocker("EMPTY_FIELD", at("title"), "The title is empty.");
    if (!card.claim.trim()) blocker("EMPTY_FIELD", at("claim"), "The claim is empty.");
    if (!card.sourceQuote.trim()) {
      blocker(
        "QUOTE_MISSING",
        at("sourceQuote"),
        "The source quote is empty.",
        "Copy a passage verbatim from the pages.",
      );
    } else if (card.sourceQuote.length > MAX_QUOTE_CHARS) {
      blocker(
        "QUOTE_TOO_LONG",
        at("sourceQuote"),
        `The quote has ${card.sourceQuote.length} characters; the limit is ${MAX_QUOTE_CHARS}.`,
        "Choose a shorter verbatim passage from one place.",
      );
    }
    if (!(card.confidence >= 0 && card.confidence <= 1)) {
      blocker(
        "CONFIDENCE_RANGE",
        at("confidence"),
        `Confidence ${card.confidence} is outside 0–1.`,
      );
    }
    if (!inRange(card.pageStart) || !inRange(card.pageEnd) || card.pageEnd < card.pageStart) {
      blocker(
        "PAGE_OUT_OF_RANGE",
        at("pageStart"),
        `Pages ${card.pageStart}–${card.pageEnd} are not inside the given pages ${range.pageStart}–${range.pageEnd}.`,
        "Use source page numbers from the task, not positions inside the attached file.",
      );
    }
    if (card.safetySensitive && !card.safetyReason?.trim()) {
      blocker(
        "SAFETY_REASON_MISSING",
        at("safetyReason"),
        "A safety-sensitive card needs a reason.",
      );
    }
    const shapes: [string, { success: boolean; error?: { issues: { message: string }[] } }][] = [
      ["procedure", ProcedureList.safeParse(card.procedure)],
      ["ingredients", IngredientList.safeParse(card.ingredients)],
      ["temperatures", TemperatureList.safeParse(card.temperatures)],
      ["timings", TimingList.safeParse(card.timings)],
      ["commonMistakes", CommonMistakeList.safeParse(card.commonMistakes)],
    ];
    for (const [field, result] of shapes) {
      if (!result.success) {
        blocker(
          "FIELD_INVALID",
          at(field),
          result.error?.issues.map((x) => x.message).join("; ") ?? "Invalid.",
        );
      }
    }
  });

  output.skippedPages.forEach((skipped, i) => {
    if (!inRange(skipped.page)) {
      issues.push({
        code: "SKIPPED_PAGE_OUT_OF_RANGE",
        severity: "MINOR",
        fieldPath: `skippedPages.${i}.page`,
        message: `Skipped page ${skipped.page} is outside ${range.pageStart}–${range.pageEnd}.`,
      });
    }
  });
  return issues;
}
