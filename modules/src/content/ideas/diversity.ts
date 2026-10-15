import { type EmbeddingProvider, embedTexts } from "@rc/lib/providers/embeddings";
import type { ideaGenerator } from "@rc/prompts";
import { cosine } from "../../localization/differentiation";
import type { OverusedTheme } from "./overuse";

// Idea diversity (plan 11 §11.5, M7-05): the model is asked for a few more ideas than wanted, and
// maximal marginal relevance picks the batch: each next idea is the one least like those already
// picked, with ideas in an overused category or angle counted as less relevant. Deterministic for
// the same answer and the same embeddings.

type Idea = ideaGenerator.IdeaDraft;

/** Relevance of an idea in an overused category, or in an overused category + angle. */
export const OVERUSED_RELEVANCE = 0.6;
/** Relevance against novelty: 1 = only relevance, 0 = only novelty. */
export const DIVERSITY_LAMBDA = 0.7;
const MAX_IDEAS_PER_CALL = 10;

/** How many ideas to ask the model for when `count` are wanted: a third more, at least one. */
export const overAsk = (count: number): number =>
  Math.min(MAX_IDEAS_PER_CALL, count + Math.max(1, Math.ceil(count / 3)));

export function ideaRelevance(idea: Idea, overused: readonly OverusedTheme[]): number {
  const hit = overused.some(
    (t) => t.category === idea.category && (t.angle === undefined || t.angle === idea.angle),
  );
  return hit ? OVERUSED_RELEVANCE : 1;
}

/**
 * Picks `count` ideas by MMR over the embeddings of their core messages. The first pick is the most
 * relevant (the model's order breaks ties); every later pick maximizes
 * λ·relevance − (1−λ)·(highest similarity to a picked idea). The picks keep the model's order.
 */
export function pickDiverse(
  ideas: readonly Idea[],
  vectors: readonly (readonly number[])[],
  options: { count: number; overused: readonly OverusedTheme[]; lambda?: number },
): { kept: Idea[]; left: Idea[] } {
  if (ideas.length <= options.count) return { kept: [...ideas], left: [] };
  const lambda = options.lambda ?? DIVERSITY_LAMBDA;
  const relevance = ideas.map((i) => ideaRelevance(i, options.overused));
  const picked: number[] = [];
  const remaining = new Set(ideas.map((_, i) => i));
  while (picked.length < options.count && remaining.size > 0) {
    let best = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const i of remaining) {
      const redundancy = picked.length
        ? Math.max(...picked.map((j) => cosine(vectors[i] ?? [], vectors[j] ?? [])))
        : 0;
      const score = lambda * (relevance[i] ?? 1) - (1 - lambda) * redundancy;
      if (score > bestScore + 1e-12) {
        best = i;
        bestScore = score;
      }
    }
    picked.push(best);
    remaining.delete(best);
  }
  picked.sort((a, b) => a - b);
  return {
    kept: picked.map((i) => ideas[i] as Idea),
    left: [...remaining].sort((a, b) => a - b).map((i) => ideas[i] as Idea),
  };
}

/** `pickDiverse` with the embeddings of the core messages. */
export async function diversifyIdeas(
  embeddings: EmbeddingProvider,
  ideas: readonly Idea[],
  options: { count: number; overused: readonly OverusedTheme[] },
): Promise<{ kept: Idea[]; left: Idea[] }> {
  if (ideas.length <= options.count) return { kept: [...ideas], left: [] };
  const vectors = (
    await embedTexts(
      embeddings,
      ideas.map((i) => i.coreMessage),
      { purpose: "document" },
    )
  ).map((e) => e.vector);
  return pickDiverse(ideas, vectors, options);
}
