import type { Permission, RightsPolicy } from "@rc/db/json";
import { RightsBlockedError } from "@rc/lib/errors";
import { describe, expect, it } from "vitest";
import {
  assertCanProcessWithAI,
  canProcessWithAI,
  canUseAsExemplar,
  canVisuallyTransform,
  type RightsSubject,
} from "./gates";

const PERMISSIONS: Permission[] = ["ALLOWED", "DENIED", "UNKNOWN"];
const STATUSES: RightsSubject["rightsStatus"][] = [
  "UNKNOWN",
  "PENDING_REVIEW",
  "CLEARED",
  "RESTRICTED",
];

const subject = (
  patch: Partial<RightsPolicy>,
  rightsStatus: RightsSubject["rightsStatus"] = "CLEARED",
): RightsSubject => ({
  id: "src-1",
  rightsStatus,
  rights: {
    use: "UNKNOWN",
    translate: "UNKNOWN",
    adapt: "UNKNOWN",
    visuallyTransform: "UNKNOWN",
    sell: "UNKNOWN",
    aiProcessing: "UNKNOWN",
    improvePrompts: "UNKNOWN",
    ...patch,
  },
});

describe("rights gates permission matrix", () => {
  for (const status of STATUSES) {
    for (const permission of PERMISSIONS) {
      const restricted = status === "RESTRICTED";

      it(`aiProcessing=${permission}, status=${status}`, () => {
        const s = subject({ aiProcessing: permission }, status);
        const expected = permission === "ALLOWED" && !restricted;
        expect(canProcessWithAI(s)).toBe(expected);
        if (expected) expect(() => assertCanProcessWithAI(s)).not.toThrow();
        else expect(() => assertCanProcessWithAI(s)).toThrow(RightsBlockedError);
      });

      it(`visuallyTransform=${permission}, status=${status}`, () => {
        const s = subject({ visuallyTransform: permission }, status);
        expect(canVisuallyTransform(s)).toBe(permission === "ALLOWED" && !restricted);
      });

      it(`improvePrompts=${permission}, status=${status}`, () => {
        const s = subject({ improvePrompts: permission }, status);
        expect(canUseAsExemplar(s)).toBe(permission !== "DENIED" && !restricted);
      });
    }
  }

  it("gates read only their own flag", () => {
    const s = subject({ use: "ALLOWED", translate: "ALLOWED", sell: "ALLOWED" });
    expect(canProcessWithAI(s)).toBe(false);
    expect(canVisuallyTransform(s)).toBe(false);
  });

  it("the error carries the code and details but a safe message", () => {
    try {
      assertCanProcessWithAI(subject({ aiProcessing: "DENIED" }, "RESTRICTED"));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RightsBlockedError);
      expect((error as RightsBlockedError).code).toBe("RIGHTS_BLOCKED");
      expect((error as RightsBlockedError).details).toMatchObject({
        sourceAssetId: "src-1",
        aiProcessing: "DENIED",
        rightsStatus: "RESTRICTED",
      });
    }
  });
});
