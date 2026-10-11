import {
  InvalidStateError,
  PermanentError,
  RightsBlockedError,
  TransientError,
  ValidationError,
} from "@rc/lib/errors";
import { jobHandlers } from "@rc/modules/job-handlers";
import { AbortTaskRunError } from "@trigger.dev/sdk";
import { describe, expect, it } from "vitest";
import { classifyJobError } from "./errors";
import { checkAccountHealth } from "./tasks/check-account-health";
import { hello } from "./tasks/hello";
import { refreshInstagramTokens } from "./tasks/refresh-instagram-tokens";

describe("classifyJobError (plan 06 §6.1)", () => {
  it.each([new TransientError("503"), new Error("ECONNRESET")])(
    "rethrows retryable %s",
    (error) => {
      expect(classifyJobError(error)).toBe(error);
    },
  );

  it.each([
    new PermanentError("400 from vendor"),
    new ValidationError("bad payload"),
    new InvalidStateError("not ready"),
    new RightsBlockedError(),
  ])("aborts without retry for %s", (error) => {
    const classified = classifyJobError(error);
    expect(classified).toBeInstanceOf(AbortTaskRunError);
    expect((classified as Error).message).toContain(error.name);
  });

  it("scrubs secrets from the abort message", () => {
    const classified = classifyJobError(
      new PermanentError("GET https://graph.instagram.com/me?access_token=IGQV-secret failed"),
    ) as Error;
    expect(classified.message).not.toContain("IGQV-secret");
  });
});

describe("tasks", () => {
  it("use the handler name as the task id", () => {
    expect(hello.id).toBe("hello");
    expect(Object.keys(jobHandlers)).toContain(hello.id);
  });

  it("registers the Instagram cron tasks under their handler names", () => {
    for (const scheduled of [refreshInstagramTokens, checkAccountHealth]) {
      expect(Object.keys(jobHandlers)).toContain(scheduled.id);
    }
    expect(refreshInstagramTokens.id).toBe("refresh-instagram-tokens");
    expect(checkAccountHealth.id).toBe("check-account-health");
  });
});
