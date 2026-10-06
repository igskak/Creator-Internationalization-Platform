import { describe, expect, it } from "vitest";
import { runtimeDatabaseUrl } from "./database-url";

const pooler = "postgresql://u:p@host:6543/postgres";
const session = "postgresql://u:p@host:5432/postgres";

describe("runtimeDatabaseUrl", () => {
  it("uses the direct URL on a developer machine when one is set", () => {
    expect(runtimeDatabaseUrl({ url: pooler, directUrl: session }, "development")).toBe(session);
  });

  it("keeps the transaction pooler where the app runs serverless or in tests", () => {
    for (const env of ["production", "staging", "test"] as const) {
      expect(runtimeDatabaseUrl({ url: pooler, directUrl: session }, env)).toBe(pooler);
    }
  });

  it("falls back to the pooler URL when there is no direct URL", () => {
    expect(runtimeDatabaseUrl({ url: pooler, directUrl: undefined }, "development")).toBe(pooler);
  });
});
