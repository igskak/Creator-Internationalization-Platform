import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { type ExtractedPage, extractPdfPages, hasTextLayer, savePages } from "./pdf";
import { SourceRejectedError } from "./sniff";

// Synthetic fixtures built in code.
const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});
const rights: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "UNKNOWN",
};
// 1×1 transparent PNG.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const PARAGRAPH =
  "Salt the water before it boils so the grains season evenly while they cook. " +
  "Keep the lid slightly open and stir only twice. Rest the pot off the heat for ten minutes. " +
  "Fluff with a fork, never a spoon, so the grains stay separate and light on the plate.";

/** Page 1 and 3: a text paragraph (> 200 chars); page 2: an image only. */
async function threePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = (page: ReturnType<typeof doc.addPage>, label: string) => {
    page.drawText(`${label} ${PARAGRAPH}`, {
      x: 40,
      y: 700,
      size: 11,
      font,
      maxWidth: 500,
      lineHeight: 14,
    });
  };
  text(doc.addPage(), "Page one.");
  const scanned = doc.addPage();
  scanned.drawImage(await doc.embedPng(PNG), { x: 0, y: 0, width: 200, height: 200 });
  text(doc.addPage(), "Page three.");
  return doc.save();
}

describe("hasTextLayer", () => {
  it("needs 200 characters and fewer than 5 % replacement characters", () => {
    expect(hasTextLayer("x".repeat(199))).toBe(false);
    expect(hasTextLayer("x".repeat(200))).toBe(true);
    expect(hasTextLayer("x".repeat(190) + "�".repeat(10))).toBe(false);
    expect(hasTextLayer("x".repeat(196) + "�".repeat(4))).toBe(true);
  });
});

describe("extractPdfPages", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rc-pdf-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns one row per page with the text-layer flag; an image-only page has none", async () => {
    const path = join(dir, "a.pdf");
    await writeFile(path, await threePagePdf());
    const pages = await extractPdfPages(path);
    expect(pages.map((p) => [p.pageNumber, p.hasTextLayer])).toEqual([
      [1, true],
      [2, false],
      [3, true],
    ]);
    expect(pages[0]?.text).toContain("Salt the water");
    expect(pages[1]).toMatchObject({ text: "", charCount: 0 });
    expect(pages[2]?.charCount).toBe(pages[2]?.text.length);
  });

  it("reports an unreadable PDF as CORRUPT_PDF", async () => {
    const path = join(dir, "bad.pdf");
    await writeFile(path, "not a pdf");
    await expect(extractPdfPages(path)).rejects.toBeInstanceOf(SourceRejectedError);
  });
});

describe("savePages", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let sourceId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" } });
    const [brand] = await t.db.select().from(schema.brands);
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId: brand?.id ?? "",
        type: "GUIDE",
        title: "g",
        originalLanguage: "ru",
        rights,
      })
      .returning();
    sourceId = source?.id ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  const page = (n: number, text: string): ExtractedPage => ({
    pageNumber: n,
    text,
    charCount: text.length,
    hasTextLayer: hasTextLayer(text),
  });
  const rows = () =>
    t.db
      .select()
      .from(schema.sourcePages)
      .where(eq(schema.sourcePages.sourceAssetId, sourceId))
      .orderBy(schema.sourcePages.pageNumber);

  it("writes the pages of the attempt and page_count", async () => {
    await savePages(ctx, sourceId, 1, [page(1, "x".repeat(250)), page(2, "")]);
    expect(
      (await rows()).map((r) => [r.pageNumber, r.hasTextLayer, r.processingAttempt, r.transcribed]),
    ).toEqual([
      [1, true, 1, false],
      [2, false, 1, false],
    ]);
    const [source] = await t.db
      .select()
      .from(schema.sourceAssets)
      .where(eq(schema.sourceAssets.id, sourceId));
    expect(source?.pageCount).toBe(2);
  });

  it("replaces rows of older attempts, and a retry of the same attempt", async () => {
    await savePages(ctx, sourceId, 1, [page(1, "old"), page(2, "old"), page(3, "old")]);
    await savePages(ctx, sourceId, 2, [page(1, "new"), page(2, "new")]);
    await savePages(ctx, sourceId, 2, [page(1, "new"), page(2, "new")]);
    expect((await rows()).map((r) => [r.pageNumber, r.text, r.processingAttempt])).toEqual([
      [1, "new", 2],
      [2, "new", 2],
    ]);
  });

  it("keeps the old pages when the new insert fails (single transaction)", async () => {
    await savePages(ctx, sourceId, 1, [page(1, "keep")]);
    await expect(
      savePages(ctx, sourceId, 2, [page(1, "a"), page(1, "duplicate page number")]),
    ).rejects.toThrow();
    expect((await rows()).map((r) => [r.text, r.processingAttempt])).toEqual([["keep", 1]]);
  });

  it("inserts large documents in chunks", async () => {
    const pages = Array.from({ length: 450 }, (_, i) => page(i + 1, `p${i + 1}`));
    await savePages(ctx, sourceId, 1, pages);
    expect(await rows()).toHaveLength(450);
  });
});
