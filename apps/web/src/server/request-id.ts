import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;

/**
 * Request id for correlation (plan 12 §12.9): keep a well-formed incoming id (e.g. from Vercel or
 * a test), otherwise create one. Anything else is replaced, so ids are safe to log and tag.
 */
export function resolveRequestId(incoming: string | null | undefined): string {
  return incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
}
