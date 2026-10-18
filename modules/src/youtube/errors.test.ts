import { describe, expect, it } from "vitest";
import { classifyYouTubeError, isRetryableYouTubeError, YouTubeCallError } from "./errors";

const google = (status: number, reason: string) => ({
  httpStatus: status,
  body: { error: { code: status, message: `msg ${reason}`, errors: [{ reason }] } },
});

describe("classifyYouTubeError", () => {
  it.each([
    [google(403, "quotaExceeded"), "RATE_LIMIT"],
    [google(403, "uploadLimitExceeded"), "RATE_LIMIT"],
    [{ httpStatus: 429 }, "RATE_LIMIT"],
    [{ httpStatus: 400, body: { error: "invalid_grant" } }, "AUTH"],
    [{ httpStatus: 401 }, "AUTH"],
    [google(403, "forbidden"), "PERMISSION"],
    [{ httpStatus: 503 }, "TRANSIENT"],
    [{ network: true }, "TRANSIENT"],
    [google(400, "invalidTitle"), "PERMANENT"],
    [{ httpStatus: 302 }, "UNKNOWN"],
  ] as const)("%j is %s", (signal, expected) => {
    expect(classifyYouTubeError(signal).classification).toBe(expected);
  });

  it("keeps the reason and Google's message, and nothing else", () => {
    expect(classifyYouTubeError(google(403, "quotaExceeded"))).toEqual({
      httpStatus: 403,
      reason: "quotaExceeded",
      message: "msg quotaExceeded",
      classification: "RATE_LIMIT",
    });
  });

  it("retries what may pass and stops on the rest, as app errors", () => {
    expect(isRetryableYouTubeError(classifyYouTubeError({ httpStatus: 502 }))).toBe(true);
    expect(isRetryableYouTubeError(classifyYouTubeError(google(400, "invalidTitle")))).toBe(false);
    const limited = new YouTubeCallError(classifyYouTubeError(google(403, "quotaExceeded")));
    expect(limited.toAppError().name).toBe("TransientError");
    const bad = new YouTubeCallError(classifyYouTubeError(google(400, "invalidTitle")));
    expect(bad.toAppError().name).toBe("PermanentError");
  });
});
