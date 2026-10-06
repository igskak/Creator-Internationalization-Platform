import { describe, expect, it } from "vitest";
import { CHUNK_OVERLAP_TOKENS, CHUNK_TOKENS, chunkPages } from "./chunking";

// Russian text: 3 characters per token, so 800 tokens are 2,400 characters.
const sentence = (n: number) => `Предложение номер ${n} про то, как правильно варить крупу. `;
const paragraph = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i))
    .join("")
    .trim();

describe("chunkPages", () => {
  it("keeps a short source in one chunk with its pages and section", () => {
    const chunks = chunkPages(
      [
        { pageNumber: 1, text: "Гречка.\nЗаливают водой.", sectionPath: "Крупы" },
        { pageNumber: 2, text: "Рис промывают." },
      ],
      "ru",
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunkIndex: 0,
      pageStart: 1,
      pageEnd: 2,
      sectionPath: "Крупы",
      text: "Гречка.\nЗаливают водой.\nРис промывают.",
    });
    expect(chunks[0]?.tokenEstimate).toBe(Math.ceil((chunks[0]?.text.length ?? 0) / 3));
  });

  it("returns nothing for empty pages", () => {
    expect(chunkPages([], "ru")).toEqual([]);
    expect(chunkPages([{ pageNumber: 1, text: " \n \n" }], "ru")).toEqual([]);
  });

  it("cuts long text near the target size, with an overlap, and numbers the chunks", () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({
      pageNumber: i + 1,
      text: [paragraph(i * 100, 8), paragraph(i * 100 + 50, 8)].join("\n"),
    }));
    const chunks = chunkPages(pages, "ru");
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) {
      expect(chunk.tokenEstimate).toBeLessThanOrEqual(CHUNK_TOKENS + CHUNK_OVERLAP_TOKENS);
    }
    // Pages never go backwards, and every page is covered.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]?.pageStart).toBeGreaterThanOrEqual(chunks[i - 1]?.pageStart ?? 0);
    }
    expect(new Set(chunks.flatMap((c) => [c.pageStart, c.pageEnd]))).toContain(6);
    // The end of one chunk opens the next.
    for (let i = 1; i < chunks.length; i++) {
      const lastSentence = chunks[i - 1]?.text.split(/(?<=[.!?…])\s+/u).at(-1) ?? "";
      expect(chunks[i]?.text).toContain(lastSentence);
    }
  });

  it("splits a paragraph longer than a chunk by sentences, and a word longer than that by characters", () => {
    const long = chunkPages([{ pageNumber: 1, text: paragraph(0, 120) }], "ru");
    expect(long.length).toBeGreaterThan(1);
    expect(long.every((c) => c.tokenEstimate <= CHUNK_TOKENS + CHUNK_OVERLAP_TOKENS)).toBe(true);
    const url = chunkPages([{ pageNumber: 1, text: "x".repeat(7000) }], "ru", {
      targetTokens: 100,
      overlapTokens: 0,
    });
    expect(url.length).toBeGreaterThan(20);
    expect(
      url
        .map((c) => c.text)
        .join("")
        .replace(/\s/gu, ""),
    ).toBe("x".repeat(7000));
  });

  it("is deterministic and gives equal text equal hashes", () => {
    const pages = [{ pageNumber: 1, text: paragraph(0, 100) }];
    const a = chunkPages(pages, "ru");
    const b = chunkPages(pages, "ru");
    expect(a).toEqual(b);
    expect(a[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(chunkPages(pages, "en").length).toBeLessThan(a.length); // 4 characters per token
  });

  it("always makes progress, even when the overlap is as big as the chunk", () => {
    const chunks = chunkPages([{ pageNumber: 1, text: paragraph(0, 30) }], "ru", {
      targetTokens: 50,
      overlapTokens: 50,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(200);
  });
});
