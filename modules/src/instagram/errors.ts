import type { INSTAGRAM_ERROR_CLASSES, InstagramError } from "@rc/db/json";
import { PermanentError, TransientError } from "@rc/lib/errors";

// Error classification of the Graph API (plan 09 §9.4.4, verified in M5-00 / V-09). Codes 32, 100
// and 613 and the 2207xxx subcodes are NOT in Meta's current error page; they come from memory and
// from the smoke runs, and every unknown code seen in production is added after investigation.

export type InstagramErrorClass = (typeof INSTAGRAM_ERROR_CLASSES)[number];

/** What a failed call looked like, before it is classified. */
export type FailureSignal = {
  /** No HTTP answer: network error or timeout. */
  network?: boolean;
  httpStatus?: number;
  /** The parsed JSON body (`{ error: { code, … } }`), if there was one. */
  body?: unknown;
};

const MIN = 60_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = MIN;

type GraphErrorBody = {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  error_subcode?: unknown;
  error_user_msg?: unknown;
  fbtrace_id?: unknown;
};

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** The `error` object of a Graph answer, or undefined. */
export function graphErrorBody(body: unknown): GraphErrorBody | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  return typeof error === "object" && error !== null ? (error as GraphErrorBody) : undefined;
}

// Subcodes that mean "Meta could not fetch or accept the image" (media fetch, size, format, ratio).
const MEDIA_FETCH_SUBCODES = new Set([2207003, 2207052, 2207082]);
const MEDIA_SUBCODES = new Set([2207004, 2207005, 2207009, 2207010, 2207011, 2207020, 2207024]);
// "Media not ready, wait a moment" (code 9007 / subcode 2207027): try again later.
const NOT_READY_SUBCODES = new Set([2207027]);
const MEDIA_WORDS =
  /\b(image|media|aspect ratio|file size|jpeg|jpg|format|dimension|resolution|url|download|fetch)\b/i;

/** Whether the failure is Meta not being able to download the image from our URL. */
export function isMediaFetchFailure(error: InstagramError): boolean {
  return (
    error.classification === "INVALID_MEDIA" &&
    ((error.subcode !== undefined && MEDIA_FETCH_SUBCODES.has(error.subcode)) ||
      /\b(download|fetch|retriev|curl)/i.test(error.message))
  );
}

/** Classifies one failed call into the stored `InstagramError`. */
export function classifyInstagramError(signal: FailureSignal): InstagramError {
  const graph = graphErrorBody(signal.body);
  const code = num(graph?.code);
  const subcode = num(graph?.error_subcode);
  const message = str(graph?.message) ?? defaultMessage(signal);
  const base = {
    ...(signal.httpStatus === undefined ? {} : { httpStatus: signal.httpStatus }),
    ...(code === undefined ? {} : { code }),
    ...(subcode === undefined ? {} : { subcode }),
    ...(str(graph?.type) ? { type: str(graph?.type) as string } : {}),
    message,
    ...(str(graph?.fbtrace_id) ? { fbtraceId: str(graph?.fbtrace_id) as string } : {}),
  };
  return { ...base, classification: classOf(signal, code, subcode, message) };
}

function defaultMessage(signal: FailureSignal): string {
  if (signal.network) return "No answer from the Graph API (network error or timeout).";
  return `The Graph API answered HTTP ${signal.httpStatus ?? "?"}.`;
}

function classOf(
  signal: FailureSignal,
  code: number | undefined,
  subcode: number | undefined,
  message: string,
): InstagramErrorClass {
  if (code === 190) return "AUTH";
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) return "PERMISSION";
  if (signal.httpStatus === 429) return "RATE_LIMIT";
  if (code !== undefined && [4, 17, 32, 341, 368, 613].includes(code)) return "RATE_LIMIT";
  if (/request limit reached|too many calls/i.test(message)) return "RATE_LIMIT";
  if (code === 1 || code === 2) return "TRANSIENT";
  if (subcode !== undefined && NOT_READY_SUBCODES.has(subcode)) return "TRANSIENT";
  if (subcode !== undefined && (MEDIA_FETCH_SUBCODES.has(subcode) || MEDIA_SUBCODES.has(subcode))) {
    return "INVALID_MEDIA";
  }
  if (code === 100 || code === 9004 || code === 9007) {
    return MEDIA_WORDS.test(message) ? "INVALID_MEDIA" : "PERMANENT";
  }
  if (signal.network) return "TRANSIENT";
  if (signal.httpStatus !== undefined && signal.httpStatus >= 500) return "TRANSIENT";
  return "UNKNOWN";
}

/** The error of a container that reached `status_code = ERROR` (no HTTP failure involved). */
export function containerError(detail?: string): InstagramError {
  return {
    message: detail ?? "Instagram could not process the media container (status ERROR).",
    classification: "INVALID_MEDIA",
  };
}

/** How long to wait before retrying a rate-limited or transient failure (plan 09 §9.4.4). */
export function retryAfterMs(error: InstagramError): number | undefined {
  switch (error.classification) {
    case "RATE_LIMIT":
      if (error.code === 368) return 15 * MIN;
      if (error.code === 4 || error.code === 17 || error.code === 613) return 5 * MIN;
      return DEFAULT_RATE_LIMIT_WAIT_MS;
    case "TRANSIENT":
      return 30_000;
    default:
      return undefined;
  }
}

/** Retrying the same call may help. */
export const isRetryableInstagramError = (error: InstagramError): boolean =>
  error.classification === "TRANSIENT" ||
  error.classification === "RATE_LIMIT" ||
  error.classification === "UNKNOWN";

/**
 * A failed Graph call. `ambiguous` is true when the request was sent but no answer came back
 * (timeout, dropped connection): a POST may have taken effect, so the caller must reconcile before
 * it repeats a call with side effects (plan 09 §9.4.3).
 */
export class InstagramCallError extends Error {
  readonly error: InstagramError;
  readonly ambiguous: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(error: InstagramError, options: { ambiguous?: boolean } = {}) {
    super(error.message);
    this.name = "InstagramCallError";
    this.error = error;
    this.ambiguous = options.ambiguous ?? false;
    this.retryAfterMs = retryAfterMs(error);
  }

  /** The error the job runner understands: retryable ones rethrow, the rest abort (06 §6.1). */
  toAppError(): TransientError | PermanentError {
    const details = { instagram: this.error };
    if (this.error.classification === "RATE_LIMIT") {
      return new TransientError(this.message, {
        rateLimited: true,
        details,
        ...(this.retryAfterMs === undefined ? {} : { retryAfterMs: this.retryAfterMs }),
        cause: this,
      });
    }
    if (isRetryableInstagramError(this.error)) {
      return new TransientError(this.message, { details, cause: this });
    }
    return new PermanentError(this.message, { details, cause: this });
  }
}

/** A sentence for the person and what to do next (shown in the publication drawer, M5-09). */
export function describeInstagramError(error: InstagramError): { title: string; nextStep: string } {
  switch (error.classification) {
    case "AUTH":
      return {
        title: "Instagram no longer accepts the connection.",
        nextStep: "Reconnect the account in Settings → Instagram, then retry the post.",
      };
    case "PERMISSION":
      return {
        title: "The app is missing a permission on this Instagram account.",
        nextStep: "Reconnect the account and accept every permission that is asked for.",
      };
    case "INVALID_MEDIA":
      return {
        title: isMediaFetchFailure(error)
          ? "Instagram could not download the slide images."
          : "Instagram refused the images or the caption.",
        nextStep: isMediaFetchFailure(error)
          ? "Retry in a few minutes. If it keeps failing, tell the team: the image links may be blocked."
          : "Open the post in review, check the slides and caption against the limits, render again and approve again.",
      };
    case "RATE_LIMIT":
      return {
        title: "Instagram is limiting how fast this account can post.",
        nextStep: "Nothing to do: the post is retried automatically after a pause.",
      };
    case "TRANSIENT":
      return {
        title: "Instagram had a temporary problem.",
        nextStep:
          "Nothing to do: the post is retried automatically. Retry by hand if it ends as failed.",
      };
    case "PERMANENT":
      return {
        title: "Instagram refused the request.",
        nextStep: "Check the details below and tell the team if it is not clear.",
      };
    default:
      return {
        title: "The post failed for an unknown reason.",
        nextStep:
          "Check the attempt timeline. Do not retry before you have checked the account for the post.",
      };
  }
}
