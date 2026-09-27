import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "./compare";

export type VerifyFailure = "malformed" | "bad_signature" | "expired";
export type VerifyResult<T> = { ok: true; data: T } | { ok: false; reason: VerifyFailure };

/** Random URL-safe nonce (128 bits by default). */
export function createNonce(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * HMAC-SHA256 signed, expiring token: `<base64url payload>.<base64url signature>`. Used for the
 * OAuth `state` ({ marketId, nonce }, 10 min). The payload is signed, not encrypted.
 */
export function signToken(
  data: Record<string, unknown>,
  { secret, expiresAt }: { secret: string; expiresAt: Date },
): string {
  const payload = Buffer.from(
    JSON.stringify({ data, exp: Math.floor(expiresAt.getTime() / 1000) }),
  ).toString("base64url");
  return `${payload}.${hmac(secret, payload)}`;
}

/** Checks signature (constant time), then expiry against `now`. */
export function verifyToken<T = Record<string, unknown>>(
  token: string,
  { secret, now }: { secret: string; now: Date },
): VerifyResult<T> {
  const parts = token.split(".");
  const [payload, signature] = parts;
  if (parts.length !== 2 || !payload || !signature) return { ok: false, reason: "malformed" };
  if (!safeEqual(signature, hmac(secret, payload))) return { ok: false, reason: "bad_signature" };

  let decoded: { data?: unknown; exp?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof decoded.exp !== "number" || typeof decoded.data !== "object" || !decoded.data) {
    return { ok: false, reason: "malformed" };
  }
  if (decoded.exp * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, data: decoded.data as T };
}

function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
