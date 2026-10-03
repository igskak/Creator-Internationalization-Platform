import type { schema } from "@rc/db";

type Card = Pick<
  typeof schema.knowledgeItems.$inferSelect,
  "title" | "claim" | "explanation" | "procedureJson" | "commonMistakesJson"
>;

/**
 * The text that stands for a card in vector space: what it says (title, claim, explanation) plus
 * its steps and mistakes, in the card's own language. Its SHA-256 is the card's `embedding_hash`,
 * so editing any of these fields makes the stored vector stale.
 */
export function cardEmbeddingText(card: Card): string {
  return [
    card.title,
    card.claim,
    card.explanation,
    ...card.procedureJson.map((step) => step.text),
    ...card.commonMistakesJson.flatMap((m) => [m.mistake, m.why ?? "", m.fix ?? ""]),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}
