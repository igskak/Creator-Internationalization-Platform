import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time equality for secrets (signatures, tokens). Both sides are hashed first, so the
 * comparison takes the same time whatever the input lengths are.
 */
export function safeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
