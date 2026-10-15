import { describe, expect, it } from "vitest";
import { mannWhitneyU, normalCdf } from "./stats";

// Known values worked out by hand (the counts of U for 5 + 5 are the coefficients of the Gaussian
// binomial [10 choose 5]: 1, 1, 2, 3, 5, 7, 9, 11, 14, 16, 18, 19, 20, 20, …; 252 in all).

describe("mannWhitneyU", () => {
  it("is exact for small samples without ties", () => {
    // Complete separation of 5 and 5: U = 25 for A, p = 2 / C(10,5) = 2 / 252.
    const r = mannWhitneyU([6, 7, 8, 9, 10], [1, 2, 3, 4, 5]);
    expect(r).toMatchObject({ u: 25, method: "exact" });
    expect(r.p).toBeCloseTo(2 / 252, 10);
  });

  it("gives a large p when the samples interleave", () => {
    const r = mannWhitneyU([1, 3, 5, 7, 9], [2, 4, 6, 8, 10]);
    expect(r.u).toBe(10);
    // P(U ≤ 10) = (1+1+2+3+5+7+9+11+14+16+18) / 252 = 87 / 252; two-sided 174 / 252.
    expect(r.p).toBeCloseTo(174 / 252, 10);
  });

  it("uses the normal approximation with ties", () => {
    const r = mannWhitneyU([0.02, 0.03, 0.03, 0.05, 0.06], [0.01, 0.02, 0.02, 0.03, 0.04]);
    expect(r.method).toBe("normal");
    // Average ranks for ties; U of A = 19.
    expect(r.u).toBe(19);
    // Mean 12.5; ties of three at 0.02 and 0.03 give σ = √(25/12 · (11 − 48/90)) = 4.6697;
    // z = (|19 − 12.5| − 0.5) / σ = 1.2849, p = 2 · (1 − Φ(z)) = 0.1988.
    expect(r.p).toBeCloseTo(0.1988, 4);
  });

  it("is symmetric and refuses an empty arm", () => {
    const a = [3, 5, 8];
    const b = [1, 2, 4, 6];
    expect(mannWhitneyU(a, b).p).toBeCloseTo(mannWhitneyU(b, a).p, 12);
    expect(() => mannWhitneyU([], b)).toThrow();
    expect(mannWhitneyU([1, 1], [1, 1]).p).toBe(1);
  });

  it("has a normal CDF that is accurate enough", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.1586553, 6);
  });
});
