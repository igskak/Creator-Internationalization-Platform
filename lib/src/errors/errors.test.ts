import { describe, expect, it } from "vitest";
import { z } from "zod";
import { serializeError } from "../logging";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  isAppError,
  isRetryable,
  NotFoundError,
  PermanentError,
  RightsBlockedError,
  TransientError,
  toPublicError,
  UnauthenticatedError,
  ValidationError,
} from "./index";

describe("error classes", () => {
  it.each([
    [new UnauthenticatedError(), "UnauthenticatedError", "UNAUTHENTICATED"],
    [new ForbiddenError(), "ForbiddenError", "FORBIDDEN"],
    [new ValidationError(), "ValidationError", "VALIDATION"],
    [new NotFoundError(), "NotFoundError", "NOT_FOUND"],
    [new ConflictError(), "ConflictError", "CONFLICT"],
    [new InvalidStateError(), "InvalidStateError", "INVALID_STATE"],
    [new RightsBlockedError(), "RightsBlockedError", "RIGHTS_BLOCKED"],
    [new TransientError("503 from vendor"), "TransientError", "EXTERNAL_ERROR"],
    [new TransientError("429", { rateLimited: true }), "TransientError", "RATE_LIMITED"],
    [new PermanentError("400 from vendor"), "PermanentError", "EXTERNAL_ERROR"],
  ])("%s has name %s and code %s", (error, name, code) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.code).toBe(code);
    expect(error.stack).toContain(name);
  });

  it("keeps details and cause", () => {
    const cause = new Error("db: 0 rows updated");
    const error = new InvalidStateError("Variant is not ready for review.", {
      details: { entity: "content_variant", id: "v1", from: ["DRAFT"], actual: "GENERATING" },
      cause,
    });
    expect(error.message).toBe("Variant is not ready for review.");
    expect(error.details).toEqual({
      entity: "content_variant",
      id: "v1",
      from: ["DRAFT"],
      actual: "GENERATING",
    });
    expect(error.cause).toBe(cause);
  });

  it("has no cause property when none is given", () => {
    expect("cause" in new NotFoundError()).toBe(false);
  });

  it("keeps retryAfterMs on transient errors", () => {
    expect(
      new TransientError("429", { rateLimited: true, retryAfterMs: 60_000 }).retryAfterMs,
    ).toBe(60_000);
  });
});

describe("ValidationError.fromZod", () => {
  it("maps issues to dotted field paths and _form", () => {
    const schema = z
      .object({ title: z.string().min(3), slides: z.array(z.object({ headline: z.string() })) })
      .refine((v) => v.slides.length > 0, "Add at least one slide");
    const result = schema.safeParse({ title: "ab", slides: [{ headline: 1 }] });
    if (result.success) throw new Error("expected failure");
    const error = ValidationError.fromZod(result.error);
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(["slides.0.headline", "title"]);
    expect(error.cause).toBe(result.error);

    const root = z.string().safeParse(1);
    if (root.success) throw new Error("expected failure");
    expect(Object.keys(ValidationError.fromZod(root.error).fieldErrors ?? {})).toEqual(["_form"]);
  });
});

describe("isRetryable", () => {
  it("retries transient errors and unknown errors", () => {
    expect(isRetryable(new TransientError("503"))).toBe(true);
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryable("thrown string")).toBe(true);
  });

  it.each([
    new PermanentError("400"),
    new ValidationError(),
    new InvalidStateError(),
    new RightsBlockedError(),
    new NotFoundError(),
    new ConflictError(),
    new ForbiddenError(),
  ])("does not retry %s", (error) => {
    expect(isRetryable(error)).toBe(false);
  });
});

describe("toPublicError", () => {
  it("shows domain messages and field errors", () => {
    expect(toPublicError(new ConflictError("Changed by Sergey. Reload."))).toEqual({
      code: "CONFLICT",
      message: "Changed by Sergey. Reload.",
    });
    expect(
      toPublicError(
        new ValidationError("Check the hook.", { fieldErrors: { hook: ["Too long"] } }),
      ),
    ).toEqual({
      code: "VALIDATION",
      message: "Check the hook.",
      fieldErrors: { hook: ["Too long"] },
    });
  });

  it("hides external messages behind a generic text", () => {
    const transient = toPublicError(
      new TransientError("429 https://api.vendor.test/v1?api_key=k", { rateLimited: true }),
    );
    expect(transient.code).toBe("RATE_LIMITED");
    expect(transient.message).not.toContain("vendor");
    const permanent = toPublicError(new PermanentError("OAuthException: invalid token abc"));
    expect(permanent).toEqual({
      code: "EXTERNAL_ERROR",
      message: "An external service failed. Try again later.",
    });
  });

  it("maps unknown errors to INTERNAL without their message or details", () => {
    const result = toPublicError(
      Object.assign(new Error("relation users does not exist"), { sql: "x" }),
    );
    expect(result.code).toBe("INTERNAL");
    expect(result.message).not.toContain("relation");
    expect(Object.keys(result)).toEqual(["code", "message"]);
  });

  it("never exposes details", () => {
    const error = new NotFoundError("Source not found.", { details: { id: "s1", path: "/x" } });
    expect(toPublicError(error)).toEqual({ code: "NOT_FOUND", message: "Source not found." });
  });
});

describe("isAppError", () => {
  it("narrows AppErrors only", () => {
    expect(isAppError(new NotFoundError())).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

describe("logging an AppError", () => {
  it("keeps code and redacted details", () => {
    const error = new PermanentError("Graph API rejected the call", {
      details: { endpoint: "/me/media", accessToken: "IGQV-secret" },
    });
    expect(serializeError(error)).toMatchObject({
      name: "PermanentError",
      code: "EXTERNAL_ERROR",
      details: { endpoint: "/me/media", accessToken: "[REDACTED]" },
    });
  });
});
