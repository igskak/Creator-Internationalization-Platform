import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { crc32 } from "node:zlib";
import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { assertNotDuplicate, detectTextEncoding, SourceRejectedError, sniffSource } from "./sniff";

// Tiny synthetic fixtures built in code; no real Reg.Chef files.

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});
const enc = (s: string) => new TextEncoder().encode(s);

async function pdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

/** Minimal PDF whose trailer points at an /Encrypt dictionary. */
const encryptedPdf = enc(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj
4 0 obj<</Filter/Standard/V 1/R 2/O(aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)/U(bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)/P -4>>endobj
trailer<</Size 5/Root 1 0 R/Encrypt 4 0 R/ID[<00><00>]>>
startxref
0
%%EOF`);

/** Stored (uncompressed) ZIP with the given entries: enough for file-type to see a DOCX. */
function zip(entries: Record<string, string>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const n = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, data);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(n.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, n);
    offset += local.length + n.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}
const docx = zip({
  "[Content_Types].xml":
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "word/document.xml": "<w:document/>",
});

/** Windows-1251 bytes for ASCII plus Cyrillic А–я. */
const cp1251 = (text: string) =>
  Uint8Array.from(
    [...text].map((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x410 && code <= 0x44f ? code - 0x350 : code;
    }),
  );

const rights: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "UNKNOWN",
};

describe("sniffSource", () => {
  let ctx: ServiceContext;
  let storage: ReturnType<typeof createMemoryStorage>;
  let paths: string[];

  beforeEach(() => {
    storage = createMemoryStorage();
    ctx = createServiceContext({ db: {} as never, logger, actor: { type: "SYSTEM" }, storage });
    paths = [];
  });
  afterEach(async () => {
    // Temp files are removed on failure; successful results are cleaned by the caller.
    for (const path of paths)
      await access(path).then(
        () => expect.unreachable(path),
        () => {},
      );
  });

  const sniff = async (
    name: string,
    bytes: Uint8Array,
    type: "GUIDE" | "NOTE" | "TRANSCRIPT" = "GUIDE",
  ) => {
    const fileKey = `sources/x/${name}`;
    await storage.put(fileKey, bytes, { contentType: "application/octet-stream" });
    return sniffSource(ctx, { fileKey, fileName: name, type });
  };
  const rejection = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => expect.unreachable("expected a rejection"),
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SourceRejectedError);
    return error as SourceRejectedError;
  };

  it("accepts a valid PDF with its page count, checksum and size", async () => {
    const bytes = await pdf(3);
    const result = await sniff("guide.pdf", bytes);
    expect(result).toMatchObject({ kind: "pdf", pageCount: 3, sizeBytes: bytes.length });
    expect(result.checksumSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    await access(result.path);
    await result.cleanup();
    await expect(access(result.path)).rejects.toThrow();
  });

  it("rejects a non-PDF renamed to .pdf, and empty files", async () => {
    expect((await rejection(sniff("fake.pdf", enc("just text")))).reason).toBe("TYPE_MISMATCH");
    expect((await rejection(sniff("empty.pdf", new Uint8Array()))).reason).toBe("EMPTY_FILE");
    expect((await rejection(sniff("fake.docx", await pdf(1)))).reason).toBe("TYPE_MISMATCH");
  });

  it("rejects an encrypted PDF and a corrupt one", async () => {
    expect((await rejection(sniff("locked.pdf", encryptedPdf))).reason).toBe("ENCRYPTED_PDF");
    const corrupt = (await pdf(2)).slice(0, 40);
    expect((await rejection(sniff("broken.pdf", corrupt))).reason).toBe("CORRUPT_PDF");
  });

  it("rejects a PDF over 1,000 pages", async () => {
    const error = await rejection(sniff("huge.pdf", await pdf(1001)));
    expect(error.reason).toBe("TOO_MANY_PAGES");
    expect(error.details).toMatchObject({ pageCount: 1001 });
    expect((await sniff("limit.pdf", await pdf(1000))).pageCount).toBe(1000);
  });

  it("accepts a DOCX and rejects a plain ZIP", async () => {
    expect((await sniff("book.docx", docx)).kind).toBe("docx");
    const plain = zip({ "a.txt": "hello" });
    expect((await rejection(sniff("a.docx", plain))).reason).toBe("TYPE_MISMATCH");
  });

  it("accepts UTF-8 and cp1251 text and tells them apart", async () => {
    const utf8 = await sniff("note.txt", enc("Привет, мир. Соль растворяется в воде."), "NOTE");
    expect(utf8).toMatchObject({ kind: "text", encoding: "utf-8" });
    const legacy = await sniff("old.txt", cp1251("Привет, мир. Соль растворяется в воде."), "NOTE");
    expect(legacy).toMatchObject({ kind: "text", encoding: "windows-1251" });
    expect(
      (await sniff("sub.srt", enc("1\n00:00:01,000 --> 00:00:02,000\nHi\n"), "TRANSCRIPT")).kind,
    ).toBe("text");
    expect((await sniff("readme.md", enc("# Title\n\nbody"), "NOTE")).encoding).toBe("utf-8");
  });

  it("rejects binary data and images renamed to .txt", async () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    ]);
    expect((await rejection(sniff("pic.txt", png, "NOTE"))).reason).toBe("TYPE_MISMATCH");
    expect(
      (await rejection(sniff("bin.txt", Uint8Array.from([1, 2, 3, 0xff, 0xfe, 0x80]), "NOTE")))
        .reason,
    ).toBe("NOT_TEXT");
  });

  it("rejects unsupported names, missing objects and files over the limit", async () => {
    expect((await rejection(sniff("a.exe", enc("x")))).reason).toBe("UNSUPPORTED_TYPE");
    expect((await rejection(sniff("a.pdf", enc("x"), "NOTE"))).reason).toBe("UNSUPPORTED_TYPE");
    const missing = sniffSource(ctx, {
      fileKey: "sources/none/a.pdf",
      fileName: "a.pdf",
      type: "GUIDE",
    });
    expect((await rejection(missing)).reason).toBe("FILE_MISSING");
    // Text limit is 20 MB; stop as soon as it is crossed.
    const big = new Uint8Array(20 * 1024 * 1024 + 1).fill(97);
    expect((await rejection(sniff("big.txt", big, "NOTE"))).reason).toBe("TOO_LARGE");
  });
});

describe("detectTextEncoding", () => {
  it("handles BOM-less ASCII, and rejects control-heavy bytes", () => {
    expect(detectTextEncoding(enc("plain ascii"))).toBe("utf-8");
    expect(() => detectTextEncoding(Uint8Array.from([65, 0, 66]))).toThrow(SourceRejectedError);
  });
});

describe("assertNotDuplicate", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let brandId: string;
  let sourceId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" } });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const [row] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId,
        type: "GUIDE",
        title: "Existing guide",
        originalLanguage: "ru",
        rights,
        checksumSha256: "abc123",
      })
      .returning();
    sourceId = row?.id ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  it("flags another active source with the same checksum and links to it", async () => {
    const error = await assertNotDuplicate(
      ctx,
      { id: "00000000-0000-4000-8000-000000000000", brandId },
      "abc123",
    ).then(
      () => null,
      (e: unknown) => e as SourceRejectedError,
    );
    expect(error?.reason).toBe("DUPLICATE_SOURCE");
    expect(error?.details).toMatchObject({ duplicateOfId: sourceId });
    expect(error?.message).toContain("Existing guide");
  });

  it("ignores itself, other checksums and archived sources", async () => {
    await assertNotDuplicate(ctx, { id: sourceId, brandId }, "abc123");
    await assertNotDuplicate(ctx, { id: "00000000-0000-4000-8000-000000000000", brandId }, "zzz");
    await t.db.update(schema.sourceAssets).set({ archivedAt: new Date() });
    await assertNotDuplicate(
      ctx,
      { id: "00000000-0000-4000-8000-000000000000", brandId },
      "abc123",
    );
  });
});
