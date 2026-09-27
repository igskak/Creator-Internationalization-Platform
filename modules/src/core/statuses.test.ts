import { describe, expect, it } from "vitest";
import type { ServiceContext } from "./context";
import { getStatuses, StatusesInput } from "./statuses";

describe("getStatuses skeleton", () => {
  it("accepts uuid lists per kind and rejects other ids or oversized lists", () => {
    const id = "0b9c6c1e-7c1a-4f8e-9d7a-2a4b6c8d0e1f";
    expect(StatusesInput.safeParse({ variantIds: [id] }).success).toBe(true);
    expect(StatusesInput.safeParse({ variantIds: ["v1"] }).success).toBe(false);
    expect(StatusesInput.safeParse({ sourceIds: Array(101).fill(id) }).success).toBe(false);
  });

  it("returns no entries until the kinds are implemented", async () => {
    expect(await getStatuses({} as ServiceContext, { variantIds: [] })).toEqual({});
  });
});
