import type { ValidationIssue } from "@rc/db/json";
import type { EmbeddingProvider } from "@rc/lib/providers/embeddings";
import { embedTexts } from "@rc/lib/providers/embeddings";
import type { ideaGenerator } from "@rc/prompts";

// Checks of the idea generator's answer (plan 07 §7.6.1): ids belong to the pool, products exist,
// no near-duplicate of a recent idea. Structural problems are BLOCKER issues (one repair, then
// the run is invalid); near-duplicates are not errors, those ideas are simply dropped.

type Output = ideaGenerator.IdeaGeneratorOutput;
type Idea = ideaGenerator.IdeaDraft;

/** Cosine of the core messages at or above which an idea counts as a repeat (07 §7.6.1). */
export const DUPLICATE_COSINE = 0.9;

export type IdeaValidationContext = {
  /** Ids of the cards the model was given. */
  cardIds: ReadonlySet<string>;
  /** Codes of the products with an active offer. */
  productCodes: ReadonlySet<string>;
  /** How many ideas were asked for. */
  count: number;
};

const blocker = (
  code: string,
  fieldPath: string,
  message: string,
  fixHint: string,
): ValidationIssue => ({
  code,
  severity: "BLOCKER",
  fieldPath,
  message,
  fixHint,
});

export function validateIdeaOutput(
  output: Output,
  context: IdeaValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (output.ideas.length > context.count) {
    issues.push(
      blocker(
        "TOO_MANY_IDEAS",
        "ideas",
        `${output.ideas.length} ideas returned, ${context.count} were asked for.`,
        `Return at most ${context.count} ideas.`,
      ),
    );
  }
  const primaryUse = new Map<string, number>();
  output.ideas.forEach((idea, i) => {
    const at = (field: string) => `ideas.${i}.${field}`;
    if (!idea.topic.trim() || !idea.coreMessage.trim()) {
      issues.push(
        blocker(
          "IDEA_TEXT_EMPTY",
          `ideas.${i}`,
          "The topic or core message is empty.",
          "Write both.",
        ),
      );
    }
    if (idea.primaryKnowledgeIds.length === 0) {
      issues.push(
        blocker(
          "PRIMARY_MISSING",
          at("primaryKnowledgeIds"),
          "The idea has no primary card.",
          "Cite at least one primary card, or drop the idea.",
        ),
      );
    }
    for (const field of ["primaryKnowledgeIds", "supportingKnowledgeIds"] as const) {
      const ids = idea[field];
      const unknown = ids.filter((id) => !context.cardIds.has(id));
      if (unknown.length > 0) {
        issues.push(
          blocker(
            "CARD_NOT_IN_POOL",
            at(field),
            `Cards that were not provided: ${unknown.join(", ")}.`,
            "Use only card ids from the knowledge cards section.",
          ),
        );
      }
      if (new Set(ids).size !== ids.length) {
        issues.push(
          blocker("CARD_REPEATED", at(field), "A card id is listed twice.", "List each card once."),
        );
      }
    }
    const both = idea.primaryKnowledgeIds.filter((id) => idea.supportingKnowledgeIds.includes(id));
    if (both.length > 0) {
      issues.push(
        blocker(
          "CARD_IN_BOTH_ROLES",
          at("supportingKnowledgeIds"),
          `A card is both primary and supporting: ${both.join(", ")}.`,
          "Keep it as primary only.",
        ),
      );
    }
    if (idea.productCode !== null && !context.productCodes.has(idea.productCode)) {
      issues.push(
        blocker(
          "PRODUCT_UNKNOWN",
          at("productCode"),
          `No active offer for the product "${idea.productCode}".`,
          "Use a product code from the offers section, or null.",
        ),
      );
    }
    if (idea.commercialIntent !== "NONE" && idea.productCode === null) {
      issues.push(
        blocker(
          "INTENT_WITHOUT_PRODUCT",
          at("commercialIntent"),
          `The commercial intent ${idea.commercialIntent} has no product.`,
          "Set a product code, or use the intent NONE.",
        ),
      );
    }
    if (idea.commercialIntent === "NONE" && idea.productCode !== null) {
      issues.push(
        blocker(
          "PRODUCT_WITHOUT_INTENT",
          at("commercialIntent"),
          "A product is set but the commercial intent is NONE.",
          "Choose the intent that fits the offer, or set the product to null.",
        ),
      );
    }
    for (const id of idea.primaryKnowledgeIds) primaryUse.set(id, (primaryUse.get(id) ?? 0) + 1);
  });
  for (const [id, uses] of primaryUse) {
    if (uses > 1) {
      issues.push({
        code: "PRIMARY_REUSED",
        severity: "MAJOR",
        fieldPath: "ideas",
        message: `The card ${id} is the primary card of ${uses} ideas of this batch.`,
        fixHint: "Give each idea its own primary card.",
      });
    }
  }
  return issues;
}

const dot = (a: readonly number[], b: readonly number[]) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
};
const cosine = (a: readonly number[], b: readonly number[]) =>
  dot(a, b) / (Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b)) || 1);

export type DroppedIdea = {
  idea: Idea;
  /** RECENT: too close to an idea of the last 60 days; BATCH: to an earlier idea of this batch. */
  reason: "RECENT" | "BATCH";
  similarTo: string;
  similarity: number;
};

/**
 * Drops ideas whose core message is at least `threshold` similar (cosine of embeddings) to a
 * recent idea or to an earlier kept idea of the same batch. Order is kept.
 */
export async function dropNearDuplicates(
  embeddings: EmbeddingProvider,
  ideas: readonly Idea[],
  recentCoreMessages: readonly string[],
  threshold = DUPLICATE_COSINE,
): Promise<{ kept: Idea[]; dropped: DroppedIdea[] }> {
  if (ideas.length === 0) return { kept: [], dropped: [] };
  const texts = [...recentCoreMessages, ...ideas.map((i) => i.coreMessage)];
  const vectors = (await embedTexts(embeddings, texts, { purpose: "document" })).map(
    (e) => e.vector,
  );
  const recentVectors = vectors.slice(0, recentCoreMessages.length);
  const kept: Idea[] = [];
  const keptVectors: number[][] = [];
  const dropped: DroppedIdea[] = [];
  ideas.forEach((idea, i) => {
    const vector = vectors[recentCoreMessages.length + i] ?? [];
    let best: { reason: "RECENT" | "BATCH"; text: string; similarity: number } | undefined;
    const consider = (reason: "RECENT" | "BATCH", text: string, other: readonly number[]) => {
      const similarity = cosine(vector, other);
      if (similarity >= threshold && (!best || similarity > best.similarity)) {
        best = { reason, text, similarity };
      }
    };
    for (const [j, v] of recentVectors.entries())
      consider("RECENT", recentCoreMessages[j] ?? "", v);
    for (const [j, v] of keptVectors.entries()) consider("BATCH", kept[j]?.coreMessage ?? "", v);
    if (best) {
      const { reason, text, similarity } = best;
      dropped.push({
        idea,
        reason,
        similarTo: text,
        similarity: Math.round(similarity * 10_000) / 10_000,
      });
    } else {
      kept.push(idea);
      keptVectors.push([...vector]);
    }
  });
  return { kept, dropped };
}
