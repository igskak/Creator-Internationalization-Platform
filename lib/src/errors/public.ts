import {
  AppError,
  DEFAULT_MESSAGES,
  type ErrorCode,
  type FieldErrors,
  TransientError,
  ValidationError,
} from "./app-error";

export type PublicError = { code: ErrorCode; message: string; fieldErrors?: FieldErrors };

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Whether a job should retry after this error (plan 06 §6.1). Only TransientError among
 * AppErrors; unknown errors are retryable too, and the job's maxAttempts caps them.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TransientError) return true;
  return !(error instanceof AppError);
}

/**
 * What the UI may see. AppErrors keep their code, and their message when it is safe to show.
 * Anything else becomes INTERNAL with a generic message; log the original with the request id.
 */
export function toPublicError(error: unknown): PublicError {
  if (!(error instanceof AppError)) {
    return { code: "INTERNAL", message: DEFAULT_MESSAGES.INTERNAL };
  }
  const result: PublicError = {
    code: error.code,
    message: error.exposeMessage ? error.message : DEFAULT_MESSAGES[error.code],
  };
  if (error instanceof ValidationError && error.fieldErrors) {
    result.fieldErrors = error.fieldErrors;
  }
  return result;
}
