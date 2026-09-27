import type { z } from "zod";

/** Codes returned to the UI in ActionResult (plan 05 §5.1). */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_STATE",
  "RIGHTS_BLOCKED",
  "RATE_LIMITED",
  "EXTERNAL_ERROR",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** User-facing text per code, used when a message is not given or not safe to show. */
export const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Sign in to continue.",
  FORBIDDEN: "You do not have permission to do this.",
  VALIDATION: "Some fields are invalid.",
  NOT_FOUND: "Not found.",
  CONFLICT: "This item was changed by someone else. Reload and try again.",
  INVALID_STATE: "This action is not allowed in the current state.",
  RIGHTS_BLOCKED: "The source rights do not allow this.",
  RATE_LIMITED: "An external service is busy. Try again in a few minutes.",
  EXTERNAL_ERROR: "An external service failed. Try again later.",
  INTERNAL: "Something went wrong. Try again or contact the team with the request id.",
};

export type FieldErrors = Record<string, string[]>;

export type AppErrorOptions = {
  /** Structured context for logs; redacted when logged, never sent to the UI. */
  details?: Record<string, unknown>;
  cause?: unknown;
};

/**
 * Base class for expected failures. `exposeMessage` says whether `message` is safe to show
 * users; if not, toPublicError() shows a generic text for the code.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly exposeMessage: boolean = true;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = DEFAULT_MESSAGES.UNAUTHENTICATED, options?: AppErrorOptions) {
    super("UNAUTHENTICATED", message, options);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = DEFAULT_MESSAGES.FORBIDDEN, options?: AppErrorOptions) {
    super("FORBIDDEN", message, options);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  readonly fieldErrors: FieldErrors | undefined;

  constructor(
    message = DEFAULT_MESSAGES.VALIDATION,
    options: AppErrorOptions & { fieldErrors?: FieldErrors } = {},
  ) {
    super("VALIDATION", message, options);
    this.name = "ValidationError";
    this.fieldErrors = options.fieldErrors;
  }

  /** Field errors keyed by dotted path (`slides.2.headline`); issues without a path go to `_form`. */
  static fromZod(error: z.ZodError, message?: string): ValidationError {
    const fieldErrors: FieldErrors = {};
    for (const issue of error.issues) {
      const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return new ValidationError(message, { fieldErrors, cause: error });
  }
}

export class NotFoundError extends AppError {
  constructor(message = DEFAULT_MESSAGES.NOT_FOUND, options?: AppErrorOptions) {
    super("NOT_FOUND", message, options);
    this.name = "NotFoundError";
  }
}

/** Optimistic locking failed (stale `lockVersion`) or a unique constraint was hit. */
export class ConflictError extends AppError {
  constructor(message = DEFAULT_MESSAGES.CONFLICT, options?: AppErrorOptions) {
    super("CONFLICT", message, options);
    this.name = "ConflictError";
  }
}

/** A status transition was refused (plan 04 §4.7 rule 6). */
export class InvalidStateError extends AppError {
  constructor(message = DEFAULT_MESSAGES.INVALID_STATE, options?: AppErrorOptions) {
    super("INVALID_STATE", message, options);
    this.name = "InvalidStateError";
  }
}

/** The source's rights do not allow this use (plan 12 §12.4). */
export class RightsBlockedError extends AppError {
  constructor(message = DEFAULT_MESSAGES.RIGHTS_BLOCKED, options?: AppErrorOptions) {
    super("RIGHTS_BLOCKED", message, options);
    this.name = "RightsBlockedError";
  }
}

/**
 * A failure that may succeed later: rate limits, 5xx, network, timeouts. Jobs rethrow it so
 * the runner retries (plan 06 §6.1). The message comes from outside and is not shown to users.
 */
export class TransientError extends AppError {
  override readonly exposeMessage = false;
  readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    options: AppErrorOptions & { rateLimited?: boolean; retryAfterMs?: number } = {},
  ) {
    super(options.rateLimited ? "RATE_LIMITED" : "EXTERNAL_ERROR", message, options);
    this.name = "TransientError";
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * An external failure that will not succeed on retry (e.g. 400/401/403/404 from a vendor API).
 * Jobs abort without retrying. The message is not shown to users.
 */
export class PermanentError extends AppError {
  override readonly exposeMessage = false;

  constructor(message: string, options?: AppErrorOptions) {
    super("EXTERNAL_ERROR", message, options);
    this.name = "PermanentError";
  }
}
