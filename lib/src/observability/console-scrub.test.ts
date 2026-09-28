import { describe, expect, it, vi } from "vitest";
import { installConsoleScrubber, scrubConsoleArgs } from "./console-scrub";

describe("scrubConsoleArgs", () => {
  it("scrubs strings, error messages and stacks, and objects", () => {
    const error = new Error("GET https://graph.instagram.com/me?access_token=IGQV-leak failed");
    const [text, err, obj, n] = scrubConsoleArgs([
      "fetch https://x.test/a?X-Amz-Signature=sig-leak",
      error,
      { headers: { cookie: "sb-leak" } },
      42,
    ]) as [string, Error, unknown, number];
    expect(text).not.toContain("sig-leak");
    expect(err.message).toContain("access_token=[REDACTED]");
    expect(err.stack).not.toContain("IGQV-leak");
    expect(JSON.stringify(obj)).not.toContain("sb-leak");
    expect(n).toBe(42);
    expect(error.message).toContain("IGQV-leak"); // the original error is not modified
  });
});

describe("installConsoleScrubber", () => {
  it("wraps error and warn once", () => {
    const error = vi.fn();
    const warn = vi.fn();
    const target = { error, warn } as unknown as Pick<Console, "error" | "warn">;
    installConsoleScrubber(target);
    installConsoleScrubber(target);
    target.error("token https://x.test/?access_token=abc-leak");
    target.warn(new Error("Bearer bearer-leak"));
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).not.toContain("abc-leak");
    const warned = warn.mock.calls[0]?.[0] as Error | undefined;
    expect(warned?.message).not.toContain("bearer-leak");
    expect(warned).toBeInstanceOf(Error);
  });
});
