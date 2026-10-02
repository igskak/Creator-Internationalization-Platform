import { describe, expect, it } from "vitest";
import { resolveRequestId } from "./request-id";

describe("resolveRequestId", () => {
  it("keeps a well-formed incoming id", () => {
    expect(resolveRequestId("fra1::abc12-1790000000000-deadbeef")).toBe(
      "fra1::abc12-1790000000000-deadbeef",
    );
    expect(resolveRequestId("8d42fec0-fc5b-4c05-9fcf-ba225d817249")).toBe(
      "8d42fec0-fc5b-4c05-9fcf-ba225d817249",
    );
  });

  it.each([null, "", "short", "has space in it", "<script>alert(1)</script>", "x".repeat(65)])(
    "replaces %j with a new UUID",
    (incoming) => {
      expect(resolveRequestId(incoming)).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});
