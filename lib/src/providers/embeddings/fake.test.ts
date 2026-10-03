import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { embeddingHash, embedTexts } from "./embed-texts";
import { createEmbeddingProvider } from "./factory";
import { createFakeEmbeddingProvider } from "./fake";
import { EMBEDDING_DIMENSIONS } from "./types";

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * (b[i] ?? 0), 0);
const norm = (a: number[]) => Math.sqrt(dot(a, a));
const embed = (p: ReturnType<typeof createFakeEmbeddingProvider>, ...texts: string[]) =>
  p.embed(texts, { purpose: "document" });

describe("FakeEmbeddingProvider", () => {
  it("is deterministic: the same text gives the same vector, in any instance and order", async () => {
    const [a1] = await embed(createFakeEmbeddingProvider(), "Соль заранее");
    const other = createFakeEmbeddingProvider();
    const [b, a2] = await embed(other, "другой текст", "Соль заранее");
    expect(a2).toEqual(a1);
    expect(b).not.toEqual(a1);
    expect((await embed(other, "Соль заранее"))[0]).toEqual(a1);
  });

  it("returns unit vectors of 1536 dimensions, and unrelated texts are nearly orthogonal", async () => {
    const p = createFakeEmbeddingProvider();
    expect(p).toMatchObject({ id: "fake", dimensions: EMBEDDING_DIMENSIONS });
    const vectors = await embed(p, "one", "two", "three", "four");
    for (const v of vectors) {
      expect(v).toHaveLength(1536);
      expect(norm(v)).toBeCloseTo(1, 6);
    }
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        expect(Math.abs(dot(vectors[i] ?? [], vectors[j] ?? []))).toBeLessThan(0.2);
      }
    }
  });

  it("makes texts of a similar group nearly identical, but not equal", async () => {
    const p = createFakeEmbeddingProvider({
      similar: [["Гречку не мешают", "Не мешайте гречку", "Гречку нельзя мешать"]],
    });
    const [a, b, c, unrelated] = await embed(
      p,
      "Гречку не мешают",
      "Не мешайте гречку",
      "Гречку нельзя мешать",
      "Рис остужают",
    );
    expect(dot(a ?? [], b ?? [])).toBeGreaterThan(0.99);
    expect(dot(a ?? [], c ?? [])).toBeGreaterThan(0.99);
    expect(dot(b ?? [], c ?? [])).toBeGreaterThan(0.99);
    expect(b).not.toEqual(a);
    expect(Math.abs(dot(a ?? [], unrelated ?? []))).toBeLessThan(0.2);
    expect(norm(b ?? [])).toBeCloseTo(1, 6);
  });

  it("supports other dimensions, records calls and ignores the purpose", async () => {
    const p = createFakeEmbeddingProvider({ dimensions: 8, model: "fake-8" });
    expect(p.model).toBe("fake-8");
    const [doc] = await p.embed(["x"], { purpose: "document" });
    const [query] = await p.embed(["x"], { purpose: "query" });
    expect(doc).toHaveLength(8);
    expect(query).toEqual(doc);
    expect(p.calls).toEqual([
      { texts: ["x"], purpose: "document" },
      { texts: ["x"], purpose: "query" },
    ]);
  });
});

describe("embedTexts", () => {
  it("returns each vector with the model and the SHA-256 of its text, in order", async () => {
    const p = createFakeEmbeddingProvider({ model: "fake-1" });
    const result = await embedTexts(p, ["alpha", "beta"], { purpose: "document" });
    expect(result.map((r) => r.model)).toEqual(["fake-1", "fake-1"]);
    expect(result.map((r) => r.hash)).toEqual([
      createHash("sha256").update("alpha").digest("hex"),
      createHash("sha256").update("beta").digest("hex"),
    ]);
    expect(result[0]?.vector).toEqual((await embed(p, "alpha"))[0]);
    expect(embeddingHash("alpha")).toBe(result[0]?.hash);
    expect(embeddingHash("alpha")).not.toBe(embeddingHash("alpha "));
  });
});

describe("createEmbeddingProvider", () => {
  it("builds the fake for AI_PROVIDER=fake and OpenAI for live", () => {
    expect(createEmbeddingProvider({ provider: "fake" }).id).toBe("fake");
    const live = createEmbeddingProvider({ provider: "live", openaiApiKey: "sk-x" });
    expect(live).toMatchObject({ id: "openai", model: "text-embedding-3-large", dimensions: 1536 });
  });
});
