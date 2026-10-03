import { crc32 } from "node:zlib";

// Tiny synthetic file builders shared by the ingestion tests; no real Reg.Chef files.

/** Stored (uncompressed) ZIP with the given entries: enough for file-type to see a DOCX. */
export function zip(entries: Record<string, string>): Uint8Array {
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
/** Windows-1251 bytes for ASCII plus Cyrillic А–я. */
export const cp1251 = (text: string) =>
  Uint8Array.from(
    [...text].map((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x410 && code <= 0x44f ? code - 0x350 : code;
    }),
  );
