import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@rc/web", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@rc/web");
  });
});
