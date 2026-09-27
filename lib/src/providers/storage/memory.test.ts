import { describe, expect, it } from "vitest";
import { storageContract } from "./contract";
import { createMemoryStorage } from "./memory";

storageContract("memory", () => createMemoryStorage(), "tmp/contract");

describe("createMemoryStorage", () => {
  it("returns copies, so callers cannot change stored bytes", async () => {
    const storage = createMemoryStorage();
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.put("tmp/x", bytes, { contentType: "application/octet-stream" });
    bytes[0] = 9;
    const read = await storage.getBytes("tmp/x");
    read[1] = 9;
    expect([...(await storage.getBytes("tmp/x"))]).toEqual([1, 2, 3]);
  });

  it("lists keys for assertions", async () => {
    const storage = createMemoryStorage();
    await storage.put("b", "1", { contentType: "text/plain" });
    await storage.put("a", "1", { contentType: "text/plain" });
    expect(storage.keys()).toEqual(["a", "b"]);
  });
});
