import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "./types";

// FakeEmbeddingProvider (plan 07 §7.3): deterministic unit vectors from a hash of the text. Unrelated
// texts get nearly orthogonal vectors; texts listed together in a `similar` group get almost the
// same vector, so dedupe tests can force a similar pair without a model.

export type FakeEmbeddingOptions = {
  dimensions?: number;
  model?: string;
  /** Groups of texts that must embed close together (cosine about 0.998). */
  similar?: readonly (readonly string[])[];
};

/** Reproducible pseudo-random numbers in [-1, 1) from a text (xorshift32 seeded by SHA-256). */
function noise(text: string, dimensions: number): number[] {
  let state = createHash("sha256").update(text).digest().readUInt32LE(0) || 1;
  return Array.from({ length: dimensions }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xffffffff) * 2 - 1;
  });
}

const normalize = (vector: number[]) => {
  const length = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / length);
};

export function createFakeEmbeddingProvider(
  options: FakeEmbeddingOptions = {},
): EmbeddingProvider & { readonly calls: { texts: string[]; purpose: string }[] } {
  const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  const base = new Map<string, string>();
  for (const group of options.similar ?? []) {
    for (const text of group) base.set(text, group[0] ?? text);
  }
  const calls: { texts: string[]; purpose: string }[] = [];

  const vectorFor = (text: string) => {
    const anchor = base.get(text) ?? text;
    const shared = noise(anchor, dimensions);
    if (anchor === text) return normalize(shared);
    // Group member: the group's vector plus a small personal offset.
    const own = noise(text, dimensions);
    return normalize(shared.map((x, i) => x + 0.05 * (own[i] ?? 0)));
  };

  return {
    id: "fake",
    model: options.model ?? "fake-embedding",
    dimensions,
    calls,
    async embed(texts, { purpose }) {
      calls.push({ texts: [...texts], purpose });
      return texts.map(vectorFor);
    },
  };
}
