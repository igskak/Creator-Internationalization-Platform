import type { YouTubeError } from "@rc/db/json";
import { PermanentError, TransientError } from "@rc/lib/errors";

// YouTube API failures, classified like the Graph API's (09 §9.4.4) so that the upload machine
// retries what may pass and stops on what will not (docs/design/youtube-shorts.md "Errors").

export type YouTubeErrorClass = YouTubeError["classification"];

/** What a failed call looked like: an HTTP answer with a JSON body, or no answer at all. */
export type YouTubeFailureSignal = { httpStatus?: number; body?: unknown; network?: boolean };

const RATE_LIMIT_REASONS = new Set([
  "quotaExceeded",
  "uploadLimitExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
]);
const AUTH_REASONS = new Set(["invalid_grant", "invalid_client", "unauthorized_client"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Google's error body: `{ error: { message, errors: [{ reason }] } }`, or OAuth's `{ error, error_description }`. */
function readBody(body: unknown): { reason?: string; message?: string } {
  const root = asRecord(body);
  const error = root?.error;
  if (typeof error === "string") {
    const description = root?.error_description;
    return {
      reason: error,
      ...(typeof description === "string" ? { message: description } : {}),
    };
  }
  const record = asRecord(error);
  if (!record) return {};
  const first = Array.isArray(record.errors) ? asRecord(record.errors[0]) : undefined;
  const reason = typeof first?.reason === "string" ? first.reason : undefined;
  const message = typeof record.message === "string" ? record.message : undefined;
  return { ...(reason ? { reason } : {}), ...(message ? { message } : {}) };
}

export function classifyYouTubeError(signal: YouTubeFailureSignal): YouTubeError {
  if (signal.network) {
    return { message: "YouTube did not answer.", classification: "TRANSIENT" };
  }
  const status = signal.httpStatus;
  const { reason, message } = readBody(signal.body);
  const base = {
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(reason ? { reason } : {}),
    message: message ?? `YouTube answered with HTTP ${status ?? "?"}.`,
  };
  const classification: YouTubeErrorClass =
    status === 429 || (reason !== undefined && RATE_LIMIT_REASONS.has(reason))
      ? "RATE_LIMIT"
      : status === 401 || (reason !== undefined && AUTH_REASONS.has(reason))
        ? "AUTH"
        : status === 403
          ? "PERMISSION"
          : status !== undefined && [500, 502, 503, 504].includes(status)
            ? "TRANSIENT"
            : status !== undefined && status >= 400 && status < 500
              ? "PERMANENT"
              : "UNKNOWN";
  return { ...base, classification };
}

export const isRetryableYouTubeError = (error: YouTubeError): boolean =>
  error.classification === "TRANSIENT" ||
  error.classification === "RATE_LIMIT" ||
  error.classification === "UNKNOWN";

/**
 * A failed YouTube call. `ambiguous`: the request was sent and no answer came back, so bytes may
 * have arrived; the machine checks the upload session before it does anything else.
 */
export class YouTubeCallError extends Error {
  readonly error: YouTubeError;
  readonly ambiguous: boolean;

  constructor(error: YouTubeError, options: { ambiguous?: boolean } = {}) {
    super(error.message);
    this.name = "YouTubeCallError";
    this.error = error;
    this.ambiguous = options.ambiguous ?? false;
  }

  /** The error the job runner understands: retryable ones rethrow, the rest abort (06 §6.1). */
  toAppError(): TransientError | PermanentError {
    const details = { youtube: this.error };
    if (this.error.classification === "RATE_LIMIT") {
      return new TransientError(this.message, { rateLimited: true, details, cause: this });
    }
    if (isRetryableYouTubeError(this.error)) {
      return new TransientError(this.message, { details, cause: this });
    }
    return new PermanentError(this.message, { details, cause: this });
  }
}
