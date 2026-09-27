import { REDACTED, scrubText } from "./scrub";

// Keys are compared lowercased with "-" and "_" removed. A key is sensitive if it equals `code`
// (OAuth code) or contains one of these fragments. Numbers and booleans under such keys are kept,
// so token counts (`inputTokens`) still reach the logs.
const SENSITIVE_FRAGMENTS = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "authorization",
  "cookie",
  "signedrequest",
  "privatekey",
  "credential",
];

const MAX_DEPTH = 8;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return normalized === "code" || SENSITIVE_FRAGMENTS.some((f) => normalized.includes(f));
}

/**
 * Returns a copy that is safe to log or store in audit data: values under sensitive keys are
 * replaced, strings are scrubbed (see scrubText), errors are serialized with serializeError,
 * binary data is summarized. The input is not modified.
 */
export function redact(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value;
  if (value instanceof URL) return scrubText(value.href);
  if (ArrayBuffer.isView(value)) return `[Binary ${value.byteLength} bytes]`;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item) => walk(item, depth + 1, seen));
  } else {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const hidden =
        isSensitiveKey(key) &&
        item !== null &&
        item !== undefined &&
        typeof item !== "number" &&
        typeof item !== "boolean";
      out[key] = hidden ? REDACTED : walk(item, depth + 1, seen);
    }
    result = out;
  }
  seen.delete(value);
  return result;
}

export type SerializedError = {
  name: string;
  message: string;
  code?: string | number;
  status?: number;
  stack?: string;
  /** AppError details (plain object), redacted. */
  details?: unknown;
  cause?: SerializedError | string;
};

/**
 * Keeps only name, message, code, HTTP status, stack, details and cause, all scrubbed or redacted.
 * Everything else on the error (SDK request configs, headers, response bodies) is dropped.
 */
export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: scrubText(safeString(error)) };
  }
  const extra = error as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    details?: unknown;
  };
  const out: SerializedError = { name: error.name, message: scrubText(error.message) };
  if (typeof extra.code === "string" || typeof extra.code === "number") out.code = extra.code;
  const status = extra.status ?? extra.statusCode;
  if (typeof status === "number") out.status = status;
  if (error.stack) out.stack = scrubText(error.stack);
  if (extra.details !== null && typeof extra.details === "object") {
    out.details = redact(extra.details);
  }
  if (error.cause !== undefined && depth < 3) {
    out.cause =
      error.cause instanceof Error
        ? serializeError(error.cause, depth + 1)
        : scrubText(safeString(error.cause));
  }
  return out;
}

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(redact(value)) ?? String(value);
  } catch {
    return String(value);
  }
}
