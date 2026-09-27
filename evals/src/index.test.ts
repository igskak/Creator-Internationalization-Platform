import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@rc/evals", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@rc/evals");
  });
});
