import { createHmac } from "node:crypto";
import { safeEqual } from "./compare";

export type SignedRequestPayload = {
  algorithm: string;
  user_id?: string;
  issued_at?: number;
  [key: string]: unknown;
};

export type SignedRequestResult =
  | { ok: true; payload: SignedRequestPayload }
  | { ok: false; reason: "malformed" | "unsupported_algorithm" | "bad_signature" };

/**
 * Parses and verifies a Meta `signed_request` (deauthorize and data-deletion callbacks):
 * `<base64url signature>.<base64url JSON payload>`, where the signature is HMAC-SHA256 of the
 * encoded payload with the app secret. Format per Meta docs; re-check with V-13 (M5-00).
 */
export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequestResult {
  const dot = signedRequest.indexOf(".");
  if (dot <= 0 || dot === signedRequest.length - 1) return { ok: false, reason: "malformed" };
  const encodedSignature = signedRequest.slice(0, dot);
  const encodedPayload = signedRequest.slice(dot + 1);

  let payload: SignedRequestPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload !== "object" || payload === null || typeof payload.algorithm !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (payload.algorithm.toUpperCase() !== "HMAC-SHA256") {
    return { ok: false, reason: "unsupported_algorithm" };
  }

  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();
  const actual = Buffer.from(encodedSignature, "base64url");
  if (!safeEqual(actual, expected)) return { ok: false, reason: "bad_signature" };
  return { ok: true, payload };
}
