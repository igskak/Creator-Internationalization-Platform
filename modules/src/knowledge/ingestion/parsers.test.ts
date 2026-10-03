import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDocx } from "./docx";
import { paginate } from "./pseudo-pages";
import { SourceRejectedError } from "./sniff";
import { cp1251, zip } from "./test-fixtures";
import { parseTextFile, textBlocks } from "./text";
import { parseCues, parseTranscriptFile } from "./transcript";

// Synthetic fixtures only; Cyrillic and Spanish text exercise the encodings.
const enc = (s: string) => new TextEncoder().encode(s);
const word = (name: string, text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${name}"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function docx(body: string): Uint8Array {
  const style = (id: string, name: string) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
  return zip({
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/_rels/document.xml.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "word/styles.xml": `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${style("Heading1", "heading 1")}${style("Heading2", "heading 2")}</w:styles>`,
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-parse-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const file = async (name: string, bytes: Uint8Array) => {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
};

describe("paginate", () => {
  const long = (n: number) => `${"слово ".repeat(n)}`.trim();

  it("fills pages up to 3,000 characters and numbers them from 1", () => {
    const blocks = Array.from({ length: 10 }, () => ({ sectionPath: null, text: long(100) }));
    const pages = paginate(blocks);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.map((p) => p.pageNumber)).toEqual(pages.map((_, i) => i + 1));
    for (const page of pages) {
      expect(page.charCount).toBeLessThanOrEqual(3000);
      expect(page.charCount).toBe(page.text.length);
      expect(page.hasTextLayer).toBe(true);
    }
  });

  it("never crosses a heading, even when the page is nearly empty", () => {
    const pages = paginate([
      { sectionPath: null, text: "intro" },
      { sectionPath: "A", text: "A" },
      { sectionPath: "A", text: "a body" },
      { sectionPath: "A › B", text: "B" },
    ]);
    expect(pages.map((p) => [p.sectionPath, p.text])).toEqual([
      [null, "intro"],
      ["A", "A\n\na body"],
      ["A › B", "B"],
    ]);
  });

  it("splits one oversized paragraph at whitespace", () => {
    const pages = paginate([{ sectionPath: null, text: long(1500) }]);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const page of pages) {
      expect(page.charCount).toBeLessThanOrEqual(3000);
      expect(page.text.startsWith("слово")).toBe(true);
      expect(page.text.endsWith("слово")).toBe(true);
    }
  });

  it("returns nothing for empty input", () => {
    expect(paginate([])).toEqual([]);
    expect(paginate([{ sectionPath: null, text: "   " }])).toEqual([]);
  });
});

describe("text files", () => {
  it("reads UTF-8 Cyrillic and Spanish, strips the BOM, keeps paragraphs", async () => {
    const text = "﻿Соль растворяется в воде.\r\n\r\n¿Cómo cocinar el arroz? Añade agua.";
    const pages = await parseTextFile(await file("a.txt", enc(text)), { markdown: false });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.text).toBe("Соль растворяется в воде.\n\n¿Cómo cocinar el arroz? Añade agua.");
    expect(pages[0]?.sectionPath).toBeNull();
  });

  it("decodes Windows-1251 files", async () => {
    const pages = await parseTextFile(
      await file("old.txt", cp1251("Привет, мир. Соль растворяется в воде.")),
      { markdown: false },
    );
    expect(pages[0]?.text).toBe("Привет, мир. Соль растворяется в воде.");
  });

  it("turns Markdown headings into section paths and ignores # inside code fences", async () => {
    const md = [
      "Вступление",
      "",
      "# Крупы",
      "",
      "Текст про крупы.",
      "",
      "## Гречка",
      "",
      "```",
      "# not a heading",
      "```",
      "",
      "# Рыба",
      "",
      "Texto sobre pescado.",
    ].join("\n");
    const pages = await parseTextFile(await file("a.md", enc(md)), { markdown: true });
    expect(pages.map((p) => p.sectionPath)).toEqual([null, "Крупы", "Крупы › Гречка", "Рыба"]);
    expect(pages[2]?.text).toContain("# not a heading");
    expect(pages[3]?.text).toBe("Рыба\n\nTexto sobre pescado.");
  });

  it("does not treat # as a heading in plain .txt", () => {
    const blocks = textBlocks("# not a heading\n\nbody", false);
    expect(blocks.map((b) => b.sectionPath)).toEqual([null, null]);
  });
});

describe("DOCX", () => {
  it("builds pages per heading with the trail as section_path", async () => {
    const body =
      para("Предисловие автора.") +
      word("Heading1", "Крупы") +
      para("Гречку промывают &amp; сушат.") +
      word("Heading2", "Рис") +
      para("Arroz: ¿cuánto tiempo? Veinte minutos.") +
      word("Heading1", "Рыба") +
      para("Соль заранее.");
    const pages = await parseDocx(await file("book.docx", docx(body)));
    expect(pages.map((p) => [p.pageNumber, p.sectionPath])).toEqual([
      [1, null],
      [2, "Крупы"],
      [3, "Крупы › Рис"],
      [4, "Рыба"],
    ]);
    expect(pages[1]?.text).toBe("Крупы\n\nГречку промывают & сушат.");
    expect(pages[2]?.text).toContain("¿cuánto tiempo?");
    expect(pages.every((p) => p.hasTextLayer)).toBe(true);
  });

  it("splits a long section into several pages under the same path", async () => {
    const body =
      word("Heading1", "Длинная глава") +
      Array.from({ length: 12 }, () => para("я".repeat(600))).join("");
    const pages = await parseDocx(await file("long.docx", docx(body)));
    expect(pages.length).toBeGreaterThan(2);
    expect(new Set(pages.map((p) => p.sectionPath))).toEqual(new Set(["Длинная глава"]));
    for (const page of pages) expect(page.charCount).toBeLessThanOrEqual(3000);
  });

  it("rejects a DOCX with no text and a damaged package", async () => {
    await expect(parseDocx(await file("empty.docx", docx("")))).rejects.toBeInstanceOf(
      SourceRejectedError,
    );
    await expect(parseDocx(await file("bad.docx", enc("not a zip")))).rejects.toMatchObject({
      reason: "CORRUPT_DOCX",
    });
  });
});

describe("transcripts", () => {
  const srt = [
    "1",
    "00:00:01,000 --> 00:00:03,500",
    "Привет! <i>Сегодня</i> готовим рис.",
    "",
    "2",
    "00:00:04,000 --> 00:01:05,250",
    "Hola, ¿qué tal?",
    "Segunda línea.",
    "",
  ].join("\r\n");

  it("parses SRT cues with millisecond times, markup removed", () => {
    expect(parseCues(srt.replace(/\r\n/g, "\n"))).toEqual([
      { startMs: 1000, endMs: 3500, text: "Привет! Сегодня готовим рис." },
      { startMs: 4000, endMs: 65_250, text: "Hola, ¿qué tal? Segunda línea." },
    ]);
  });

  it("parses WebVTT: header, NOTE, ids, short times and cue settings", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE a comment",
      "",
      "intro",
      "00:01.000 --> 00:02.000 align:start position:0%",
      "<v Chef>Salt early.</v>",
      "",
      "01:00:00.500 --> 01:00:01.000",
      "One hour in.",
    ].join("\n");
    expect(parseCues(vtt)).toEqual([
      { startMs: 1000, endMs: 2000, text: "Salt early." },
      { startMs: 3_600_500, endMs: 3_601_000, text: "One hour in." },
    ]);
  });

  it("merges cues into segments with a locator spanning first start to last end", async () => {
    const cues = Array.from(
      { length: 120 },
      (_, i) =>
        `${i + 1}\n00:${String(Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")},000 --> 00:${String(Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10 + 9).padStart(2, "0")},000\n${"Реплика номер ".repeat(2)}${i + 1}`,
    ).join("\n\n");
    const pages = await parseTranscriptFile(await file("t.srt", enc(cues)));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.charCount).toBeLessThanOrEqual(3000);
      expect(page.sectionPath).toBeNull();
      expect(page.locator?.startMs).toBeLessThan(page.locator?.endMs ?? 0);
    }
    expect(pages[0]?.locator?.startMs).toBe(0);
    expect(pages.at(-1)?.locator?.endMs).toBe(19 * 60_000 + 59_000);
    expect(pages[1]?.locator?.startMs).toBeGreaterThanOrEqual(pages[0]?.locator?.endMs ?? 0);
  });

  it("decodes a Windows-1251 SRT and rejects a file without cues", async () => {
    const legacy = cp1251("1\n00:00:01,000 --> 00:00:02,000\nПривет, мир. Соль растворяется.\n");
    const pages = await parseTranscriptFile(await file("old.srt", legacy));
    expect(pages[0]?.text).toBe("Привет, мир. Соль растворяется.");
    await expect(
      parseTranscriptFile(await file("none.vtt", enc("WEBVTT\n\nnothing here"))),
    ).rejects.toBeInstanceOf(SourceRejectedError);
  });
});
