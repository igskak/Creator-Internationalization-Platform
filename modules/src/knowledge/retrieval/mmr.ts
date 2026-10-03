// Maximal marginal relevance (plan 07 §7.9.1): pick items that are relevant and different from
// what is already picked. score = λ · relevance − (1 − λ) · (highest similarity to a picked item).

export type MmrCandidate = { id: string; vector: readonly number[]; relevance: number };

const dot = (a: readonly number[], b: readonly number[]) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
};

const unit = (v: readonly number[]) => {
  const length = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / length);
};

/**
 * Selects up to `limit` ids in pick order. Similarity is cosine; the highest similarity to the
 * picked set is updated after each pick, so the cost is `limit × candidates` dot products. Ties
 * go to the smaller id, so the result is the same on every run.
 */
export function selectMmr(
  candidates: readonly MmrCandidate[],
  limit: number,
  lambda = 0.7,
): string[] {
  const items = candidates.map((c) => ({
    id: c.id,
    relevance: c.relevance,
    vector: unit(c.vector),
  }));
  const maxSimilarity = new Array<number>(items.length).fill(0);
  const picked: string[] = [];
  const taken = new Set<number>();

  while (picked.length < Math.min(limit, items.length)) {
    let best = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const [i, item] of items.entries()) {
      if (taken.has(i)) continue;
      // Nothing is picked yet: the first pick is the most relevant one.
      const score =
        picked.length === 0
          ? item.relevance
          : lambda * item.relevance - (1 - lambda) * (maxSimilarity[i] ?? 0);
      const better =
        score > bestScore + 1e-12 ||
        (Math.abs(score - bestScore) <= 1e-12 && best >= 0 && item.id < (items[best]?.id ?? ""));
      if (better) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) break;
    taken.add(best);
    const chosen = items[best];
    if (!chosen) break;
    picked.push(chosen.id);
    for (const [i, item] of items.entries()) {
      if (taken.has(i)) continue;
      maxSimilarity[i] = Math.max(maxSimilarity[i] ?? 0, dot(item.vector, chosen.vector));
    }
  }
  return picked;
}
