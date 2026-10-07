import type { ValidationIssue, Validator } from "./types";

// First-person chef statements and attributions [S§6.3]: allowed only for cited claims.
const CHEF_ATTRIBUTION = new RegExp(
  [
    String.raw`as a chef`,
    String.raw`chef (?:says|said|recommends|explains|always|never)`,
    String.raw`according to (?:the |our )?chef`,
    String.raw`in my kitchen`,
    String.raw`my (?:trick|secret|rule)`,
    String.raw`I (?:always|never|learned|swear)`,
    String.raw`como chef`,
    String.raw`el chef (?:dice|recomienda|explica|siempre|nunca)`,
    String.raw`seg[uú]n (?:el|nuestro) chef`,
    String.raw`en mi cocina`,
    String.raw`mi (?:truco|secreto|regla)`,
    String.raw`yo (?:siempre|nunca|aprend[ií])`,
  ]
    .map((p) => `(?<![\\p{L}\\d])(?:${p})(?![\\p{L}\\d])`)
    .join("|"),
  "iu",
);

/**
 * Every factual slide cites at least one card; every cited id (slides and `claimsUsed`) belongs to
 * the Master Idea; chef attributions appear only on slides that cite a card (in the hook and
 * caption, only when some slide cites one).
 */
export const validateCitations: Validator = (draft, context) => {
  const issues: ValidationIssue[] = [];
  const notInIdea = (ids: readonly string[]) =>
    ids.filter((id) => !context.ideaKnowledgeIds.has(id));

  for (const slide of draft.slides) {
    if (slide.factual && slide.knowledgeIds.length === 0) {
      issues.push({
        code: "FACTUAL_SLIDE_UNCITED",
        severity: "BLOCKER",
        fieldPath: `slides.${slide.id}`,
        message: "A factual slide cites no knowledge card.",
        fixHint:
          "Cite at least one card of the idea, or mark the slide as not factual and remove the claim.",
      });
    }
    const foreign = notInIdea(slide.knowledgeIds);
    if (foreign.length > 0) {
      issues.push({
        code: "CITATION_NOT_IN_IDEA",
        severity: "BLOCKER",
        fieldPath: `slides.${slide.id}.knowledgeIds`,
        message: `The slide cites cards that do not belong to the idea: ${foreign.join(", ")}.`,
        fixHint: "Cite only the cards given for this idea.",
      });
    }
    if (slide.knowledgeIds.length === 0) {
      for (const [slot, text] of Object.entries(slide.slots)) {
        if (CHEF_ATTRIBUTION.test(text)) issues.push(chefIssue(`slides.${slide.id}.slots.${slot}`));
      }
    }
  }
  for (const claim of draft.claimsUsed ?? []) {
    const foreign = notInIdea(claim.knowledgeIds);
    if (foreign.length > 0 || claim.knowledgeIds.length === 0) {
      issues.push({
        code: foreign.length > 0 ? "CITATION_NOT_IN_IDEA" : "CLAIM_UNCITED",
        severity: "BLOCKER",
        fieldPath: "claimsUsed",
        message:
          foreign.length > 0
            ? `A claim cites cards that do not belong to the idea: ${foreign.join(", ")}.`
            : `The claim "${claim.text}" cites no card.`,
        fixHint: "Support every claim with a card of the idea.",
      });
    }
  }
  const anyCited = draft.slides.some((s) => s.knowledgeIds.length > 0);
  if (!anyCited) {
    for (const [fieldPath, text] of [
      ["hook", draft.hook],
      ["caption", draft.caption],
    ] as const) {
      if (CHEF_ATTRIBUTION.test(text)) issues.push(chefIssue(fieldPath));
    }
  }
  return issues;
};

function chefIssue(fieldPath: string): ValidationIssue {
  return {
    code: "CHEF_ATTRIBUTION_UNCITED",
    severity: "BLOCKER",
    fieldPath,
    message: "The text speaks in the chef's name without citing a card.",
    fixHint:
      "Drop the first-person or chef attribution, or cite the card the statement comes from.",
  };
}
