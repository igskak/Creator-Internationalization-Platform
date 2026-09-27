import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../errors";
import type { StorageProvider } from "./types";

// Behaviour every StorageProvider must have. Run against the fake in unit tests and against R2
// in the gated live test.

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

export function storageContract(name: string, make: () => StorageProvider, prefix: string) {
  describe(`${name}: StorageProvider contract`, () => {
    const key = (suffix: string) => `${prefix}/${suffix}`;

    it("puts, heads, reads bytes and streams", async () => {
      const storage = make();
      await storage.put(key("a.txt"), "hello ¡olé!", { contentType: "text/plain; charset=utf-8" });
      const info = await storage.head(key("a.txt"));
      expect(info?.size).toBe(new TextEncoder().encode("hello ¡olé!").byteLength);
      expect(info?.contentType).toBe("text/plain; charset=utf-8");
      expect(new TextDecoder().decode(await storage.getBytes(key("a.txt")))).toBe("hello ¡olé!");
      expect(await readAll(await storage.getStream(key("a.txt")))).toBe("hello ¡olé!");
      await storage.delete(key("a.txt"));
    });

    it("stores binary data unchanged", async () => {
      const storage = make();
      const bytes = new Uint8Array([0, 255, 128, 7, 0]);
      await storage.put(key("b.bin"), bytes, { contentType: "application/octet-stream" });
      expect([...(await storage.getBytes(key("b.bin")))]).toEqual([...bytes]);
      await storage.delete(key("b.bin"));
    });

    it("returns null from head and NotFoundError from reads for missing objects", async () => {
      const storage = make();
      expect(await storage.head(key("missing"))).toBeNull();
      await expect(storage.getBytes(key("missing"))).rejects.toBeInstanceOf(NotFoundError);
      await expect(storage.getStream(key("missing"))).rejects.toBeInstanceOf(NotFoundError);
    });

    it("deletes, and deleting a missing object is not an error", async () => {
      const storage = make();
      await storage.put(key("c.txt"), "x", { contentType: "text/plain" });
      await storage.delete(key("c.txt"));
      expect(await storage.head(key("c.txt"))).toBeNull();
      await expect(storage.delete(key("c.txt"))).resolves.toBeUndefined();
    });

    it("overwrites an existing key", async () => {
      const storage = make();
      await storage.put(key("d.txt"), "one", { contentType: "text/plain" });
      await storage.put(key("d.txt"), "two!", { contentType: "text/plain" });
      expect((await storage.head(key("d.txt")))?.size).toBe(4);
      await storage.delete(key("d.txt"));
    });

    it("presigns uploads and downloads with an expiry", async () => {
      const storage = make();
      const before = Date.now();
      const upload = await storage.presignPut(key("e.pdf"), {
        contentType: "application/pdf",
        contentLength: 10,
        expiresInSeconds: 900,
      });
      expect(upload.headers).toEqual({ "Content-Type": "application/pdf" });
      expect(upload.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 899_000);
      const download = await storage.presignGet(key("e.pdf"), { expiresInSeconds: 600 });
      expect(download.url).toContain("e.pdf");
    });
  });
}
