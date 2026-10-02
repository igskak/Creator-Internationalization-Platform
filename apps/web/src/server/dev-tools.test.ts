import { NotFoundError } from "@rc/lib/errors";
import { describe, expect, it } from "vitest";
import { assertDevTools, isDevToolsEnabled } from "./dev-tools";

describe("dev tools guard", () => {
  it("is enabled only in development", () => {
    expect(isDevToolsEnabled("development")).toBe(true);
    for (const env of ["production", "staging", "test", ""]) {
      expect(isDevToolsEnabled(env)).toBe(false);
      expect(() => assertDevTools(env)).toThrow(NotFoundError);
    }
    expect(() => assertDevTools("development")).not.toThrow();
  });
});
