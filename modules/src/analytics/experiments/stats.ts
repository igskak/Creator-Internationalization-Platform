// Mann–Whitney U test (plan 11 §11.6, M7-06): do two arms' D7 rates come from the same
// distribution? Two-sided. Exact distribution for small samples without ties (the usual case with
// 5–20 posts per arm), the normal approximation with a tie correction and a continuity correction
// otherwise. Pure functions, tested against known values.

export type MannWhitney = {
  /** U of the first sample: how often a value of A is above a value of B (ties count half). */
  u: number;
  /** Two-sided p-value. */
  p: number;
  method: "exact" | "normal";
};

const EXACT_MAX = 20;

/** Ranks with ties given their average rank (1-based). */
function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.[0] === order[i]?.[0]) j++;
    const rank = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) out[order[k]?.[1] ?? 0] = rank;
    i = j + 1;
  }
  return out;
}

/** P(U ≤ u) under H0 for sizes m, n without ties: counts of arrangements by dynamic programming. */
function exactCdf(m: number, n: number, u: number): number {
  // f[i][j][k]: arrangements of i A's and j B's with U = k. Built row by row over i.
  const maxU = m * n;
  let prev: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(maxU + 1).fill(0));
  for (let j = 0; j <= n; j++) (prev[j] as number[])[0] = 1; // i = 0: U is 0
  for (let i = 1; i <= m; i++) {
    const cur: number[][] = Array.from({ length: n + 1 }, () =>
      new Array<number>(maxU + 1).fill(0),
    );
    (cur[0] as number[])[0] = 1; // j = 0: U is 0
    for (let j = 1; j <= n; j++) {
      const row = cur[j] as number[];
      for (let k = 0; k <= maxU; k++) {
        // The largest value is an A (it beats all j B's) or a B.
        const withA = k - j >= 0 ? ((prev[j] as number[])[k - j] ?? 0) : 0;
        const withB = (cur[j - 1] as number[])[k] ?? 0;
        row[k] = withA + withB;
      }
    }
    prev = cur;
  }
  const counts = prev[n] as number[];
  const total = counts.reduce((s, c) => s + c, 0);
  let below = 0;
  for (let k = 0; k <= Math.floor(u); k++) below += counts[k] ?? 0;
  return below / total;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 on erf; error below 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export function mannWhitneyU(a: readonly number[], b: readonly number[]): MannWhitney {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) throw new Error("Both samples need values.");
  const all = [...a, ...b];
  const r = ranks(all);
  const rankSumA = r.slice(0, m).reduce((s, x) => s + x, 0);
  const u = rankSumA - (m * (m + 1)) / 2;
  const hasTies = new Set(all).size < all.length;
  const uMin = Math.min(u, m * n - u);

  if (!hasTies && m <= EXACT_MAX && n <= EXACT_MAX) {
    const p = Math.min(1, 2 * exactCdf(m, n, uMin));
    return { u, p, method: "exact" };
  }
  const nAll = m + n;
  const tieTerm = (() => {
    const counts = new Map<number, number>();
    for (const v of all) counts.set(v, (counts.get(v) ?? 0) + 1);
    let sum = 0;
    for (const t of counts.values()) sum += t ** 3 - t;
    return sum / (nAll * (nAll - 1));
  })();
  const sigma = Math.sqrt(((m * n) / 12) * (nAll + 1 - tieTerm));
  if (sigma === 0) return { u, p: 1, method: "normal" };
  const mean = (m * n) / 2;
  const z = (Math.abs(u - mean) - 0.5) / sigma;
  const p = Math.min(1, 2 * (1 - normalCdf(Math.max(0, z))));
  return { u, p, method: "normal" };
}
