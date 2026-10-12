import type { KnowledgeSnapshot, Slide, VisualBrief, VisualHypothesis } from "@rc/db/json";
import type { visualDirector } from "@rc/prompts";
import type { TemplateRegistry } from "@rc/templates";
import type { VisualValidationContext } from "./validate";

// Input of the visual director and the context its answer is checked against (M3-02).

export type TaxonomyTerm = { code: string; label: string };

/** A library photo the director may pick (M3-16 fills the list; until then it is empty). */
export type LibraryCandidate = { id: string; description: string; tags: string[] };

export type SiblingVisual = { marketCode: string; brief: VisualBrief };

/** The parts of an idea's approved card the director reads as the recipe (visual-director@4). */
export type RecipeCard = { id: string } & Pick<
  KnowledgeSnapshot,
  "title" | "claim" | "procedure" | "ingredients" | "commonMistakes"
>;

/** "200 g quinoa (rinsed)": an ingredient of a card as one line. */
const ingredientLine = (i: KnowledgeSnapshot["ingredients"][number]) =>
  [i.quantity, i.unit, i.name].filter((p) => p !== undefined && p !== "").join(" ") +
  (i.note ? ` (${i.note})` : "");

/** The recipe section of the director's input: steps, ingredients and mistakes of the cards. */
export const recipeOf = (
  cards: readonly RecipeCard[],
): visualDirector.VisualDirectorInput["recipe"] =>
  cards.map((card) => ({
    id: card.id,
    title: card.title,
    claim: card.claim,
    steps: [...card.procedure].sort((a, b) => a.n - b.n).map((s) => s.text),
    ingredients: card.ingredients.map(ingredientLine),
    mistakes: card.commonMistakes.map((m) => (m.fix ? `${m.mistake} → ${m.fix}` : m.mistake)),
  }));

/** Hypotheses worth offering: not rejected ones. */
export const usableHypotheses = (all: readonly VisualHypothesis[]) =>
  all.filter((h) => h.status !== "REJECTED");

export function visualInput(args: {
  idea: { topic: string; coreMessage: string };
  market: { code: string; displayName: string; hypotheses: readonly VisualHypothesis[] };
  slides: readonly Slide[];
  templates: Pick<TemplateRegistry, "get">;
  library: readonly LibraryCandidate[];
  siblings: readonly SiblingVisual[];
  visualStyles: readonly TaxonomyTerm[];
  /** The idea's approved cards; their steps and ingredients are the recipe of the pictures. */
  cards?: readonly RecipeCard[];
}): visualDirector.VisualDirectorInput {
  return {
    idea: args.idea,
    market: {
      code: args.market.code,
      displayName: args.market.displayName,
      hypotheses: usableHypotheses(args.market.hypotheses).map((h) => ({
        id: h.id,
        description: h.description,
        visualStyle: h.visualStyle,
        status: h.status,
      })),
    },
    slides: args.slides.map((s) => ({
      slideId: s.id,
      index: s.index,
      role: s.role,
      templateId: s.templateId,
      slots: Object.entries(s.slots).map(([name, text]) => ({ name, text })),
      imageSlots: Object.entries(args.templates.get(s.templateId)?.imageSlots ?? {}).map(
        ([name, spec]) => ({ name, aspect: spec.aspect, required: spec.required }),
      ),
    })),
    libraryCandidates: args.library.map((p) => ({
      id: p.id,
      description: p.description,
      tags: p.tags,
    })),
    siblingBriefs: args.siblings.map((s) => ({
      marketCode: s.marketCode,
      concept: s.brief.concept,
      visualStyle: s.brief.visualStyle,
      compositions: s.brief.slides.map((e) => e.composition).filter(Boolean),
    })),
    visualStyles: [...args.visualStyles],
    recipe: recipeOf(args.cards ?? []),
  };
}

export function visualValidationContext(args: {
  slides: readonly Slide[];
  templates: Pick<TemplateRegistry, "get">;
  library: readonly LibraryCandidate[];
  visualStyles: readonly TaxonomyTerm[];
  hypotheses: readonly VisualHypothesis[];
}): VisualValidationContext {
  return {
    slides: args.slides,
    templates: args.templates,
    libraryIds: new Set(args.library.map((p) => p.id)),
    visualStyles: new Set(args.visualStyles.map((t) => t.code)),
    hypothesisIds: new Set(usableHypotheses(args.hypotheses).map((h) => h.id)),
  };
}
