import { createHash } from "node:crypto";
import type { EmbeddedText, EmbeddingProvider } from "./types";

/**
 * SHA-256 of the embedded text (`embedding_hash`). A row whose hash and `embedding_model` both
 * match needs no new embedding; the model is compared separately, so a model change re-embeds.
 */
export const embeddingHash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Embeds texts and returns each vector with its model and text hash, in input order. */
export async function embedTexts(
  provider: EmbeddingProvider,
  texts: readonly string[],
  options: { purpose: "document" | "query" },
): Promise<EmbeddedText[]> {
  const vectors = await provider.embed(texts, options);
  return texts.map((text, i) => ({
    vector: vectors[i] ?? [],
    model: provider.model,
    hash: embeddingHash(text),
  }));
}
