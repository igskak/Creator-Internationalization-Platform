import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/health (H-01): the liveness answer of the health module, 503 only when the database
// is down, never cached.

const checkLiveness = vi.hoisted(() => vi.fn());
vi.mock("@rc/modules/health", () => ({ checkLiveness }));
vi.mock("@/server/context", () => ({ requestContext: vi.fn(async () => ({})) }));
vi.mock("@/server/runtime", () => ({
  serverEnv: () => ({ observability: { release: "abc123" } }),
}));

const { GET } = await import("./route");

beforeEach(() => vi.clearAllMocks());

describe("GET /api/health", () => {
  it("returns ok with the checks and the release", async () => {
    checkLiveness.mockResolvedValue({
      status: "ok",
      version: "abc123",
      checks: { db: "GREEN", storage: "GREEN" },
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      version: "abc123",
      checks: { db: "GREEN", storage: "GREEN" },
    });
    expect(checkLiveness).toHaveBeenCalledWith({}, "abc123");
  });

  it("answers degraded with 200 and down with 503", async () => {
    checkLiveness.mockResolvedValueOnce({
      status: "degraded",
      version: null,
      checks: { db: "GREEN", storage: "RED" },
    });
    expect((await GET()).status).toBe(200);
    checkLiveness.mockResolvedValueOnce({
      status: "down",
      version: null,
      checks: { db: "RED", storage: "GREEN" },
    });
    expect((await GET()).status).toBe(503);
  });
});
