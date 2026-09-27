import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@rc/prompts", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@rc/prompts");
  });
});
