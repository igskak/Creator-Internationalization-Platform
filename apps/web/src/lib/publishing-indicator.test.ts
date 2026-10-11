import { describe, expect, it } from "vitest";
import { publishingIndicator } from "./publishing-indicator";

describe("publishingIndicator", () => {
  it.each([
    ["off", false, "off"],
    ["off", true, "off"],
    ["dry_run_only", false, "dryRun"],
    ["dry_run_only", true, "dryRun"],
    ["live", false, "paused"],
    ["live", true, "live"],
  ] as const)("mode %s, switch %s → %s", (mode, enabled, expected) => {
    expect(publishingIndicator({ mode, enabled })).toBe(expected);
  });
});
