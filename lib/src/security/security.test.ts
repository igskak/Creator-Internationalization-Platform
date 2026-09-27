import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadServerEnv } from "../env";
import { PermanentError } from "../errors";
import {
  createNonce,
  decrypt,
  encrypt,
  encryptedKeyId,
  type KeyRing,
  parseSignedRequest,
  safeEqual,
  signToken,
  verifyToken,
} from "./index";

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const ringV1: KeyRing = { keys: new Map([["v1", k1]]), activeKeyId: "v1" };
const ringV2: KeyRing = {
  keys: new Map([
    ["v1", k1],
    ["v2", k2],
  ]),
  activeKeyId: "v2",
};
const aad = "3f1c2e7a-social-account-id";
const token = "IGQVJ-synthetic-long-lived-token";

function swapChar(part: string): string {
  return (part[0] === "A" ? "B" : "A") + part.slice(1);
}

describe("encrypt / decrypt", () => {
  it("round-trips with the active key and the enc:v1 format", () => {
    const value = encrypt(token, { keyRing: ringV1, aad });
    expect(value).toMatch(/^enc:v1:[\w-]{16}:[\w-]{22}:[\w-]+$/);
    expect(value).not.toContain(token);
    expect(decrypt(value, { keyRing: ringV1, aad })).toBe(token);
  });

  it("uses a fresh IV every time", () => {
    const a = encrypt(token, { keyRing: ringV1, aad });
    const b = encrypt(token, { keyRing: ringV1, aad });
    expect(a).not.toBe(b);
  });

  it.each([
    ["iv", 2],
    ["tag", 3],
    ["ciphertext", 4],
  ])("detects a tampered %s", (_part, index) => {
    const parts = encrypt(token, { keyRing: ringV1, aad }).split(":");
    parts[index] = swapChar(parts[index] ?? "");
    expect(() => decrypt(parts.join(":"), { keyRing: ringV1, aad })).toThrow(PermanentError);
  });

  it("fails with a different AAD (ciphertext copied to another row)", () => {
    const value = encrypt(token, { keyRing: ringV1, aad });
    expect(() => decrypt(value, { keyRing: ringV1, aad: "other-account-id" })).toThrow(
      /Decryption failed/,
    );
  });

  it("decrypts values made with an older key after rotation; encrypts with the new one", () => {
    const old = encrypt(token, { keyRing: ringV1, aad });
    expect(decrypt(old, { keyRing: ringV2, aad })).toBe(token);
    const fresh = encrypt(token, { keyRing: ringV2, aad });
    expect(encryptedKeyId(old)).toBe("v1");
    expect(encryptedKeyId(fresh)).toBe("v2");
  });

  it("fails when the key id is not in the ring, without leaking the value", () => {
    const value = encrypt(token, { keyRing: ringV2, aad });
    const error = (() => {
      try {
        decrypt(value, { keyRing: ringV1, aad });
      } catch (e) {
        return e as PermanentError;
      }
    })();
    expect(error).toBeInstanceOf(PermanentError);
    expect(error?.details).toEqual({ keyId: "v2" });
    expect(error?.message).not.toContain(token);
  });

  it.each(["", "plain-token", "enc:v1:abc", "enc:v1:AAAA:BBBB:CCCC", "xyz:v1:a:b:c"])(
    "rejects malformed value %j",
    (value) => {
      expect(() => decrypt(value, { keyRing: ringV1, aad })).toThrow(/malformed/);
    },
  );

  it("requires an AAD", () => {
    expect(() => encrypt(token, { keyRing: ringV1, aad: "" })).toThrow(/AAD/);
  });

  it("works with the key ring from loadServerEnv", () => {
    const env = loadServerEnv({
      DATABASE_URL: "postgresql://u:p@localhost/db",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      TOKEN_ENCRYPTION_KEYS: `v1:${k1.toString("base64")},v2:${k2.toString("base64")}`,
      TOKEN_ENCRYPTION_ACTIVE_KEY: "v2",
      OAUTH_STATE_SECRET: "s".repeat(32),
      AI_PROVIDER: "fake",
      STORAGE_PROVIDER: "memory",
    });
    const keyRing = {
      keys: env.security.tokenEncryptionKeys,
      activeKeyId: env.security.activeKeyId,
    };
    const old = encrypt(token, { keyRing: ringV1, aad });
    expect(decrypt(old, { keyRing, aad })).toBe(token);
  });
});

describe("signToken / verifyToken (OAuth state)", () => {
  const secret = "state-secret-at-least-32-characters!!";
  const now = new Date("2026-09-27T12:00:00Z");
  const in10min = new Date(now.getTime() + 10 * 60_000);
  const state = { marketId: "es-market-id", nonce: createNonce() };

  it("verifies a valid token and returns the data", () => {
    const signed = signToken(state, { secret, expiresAt: in10min });
    expect(verifyToken(signed, { secret, now })).toEqual({ ok: true, data: state });
  });

  it("rejects an expired token", () => {
    const signed = signToken(state, { secret, expiresAt: in10min });
    expect(verifyToken(signed, { secret, now: in10min })).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a bad signature, a wrong secret and a changed payload", () => {
    const signed = signToken(state, { secret, expiresAt: in10min });
    const [payload, signature] = signed.split(".") as [string, string];
    expect(verifyToken(`${payload}.${swapChar(signature)}`, { secret, now })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(verifyToken(signed, { secret: `${secret}x`, now })).toMatchObject({
      reason: "bad_signature",
    });
    const forged = Buffer.from(
      JSON.stringify({ data: { marketId: "en-market-id" }, exp: 4102444800 }),
    ).toString("base64url");
    expect(verifyToken(`${forged}.${signature}`, { secret, now })).toMatchObject({
      reason: "bad_signature",
    });
  });

  it.each(["", "no-dot", "a.b.c", ".sig", "payload."])("rejects malformed token %j", (value) => {
    expect(verifyToken(value, { secret, now })).toEqual({ ok: false, reason: "malformed" });
  });

  it("creates distinct URL-safe nonces", () => {
    const a = createNonce();
    expect(a).toMatch(/^[\w-]{22}$/);
    expect(createNonce()).not.toBe(a);
  });
});

describe("parseSignedRequest (Meta callbacks)", () => {
  const appSecret = "synthetic-app-secret";

  function makeSignedRequest(payload: object, secret = appSecret): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
    return `${signature}.${encoded}`;
  }

  const payload = { algorithm: "HMAC-SHA256", user_id: "17841400000000000", issued_at: 1790000000 };

  it("parses a valid signed request", () => {
    expect(parseSignedRequest(makeSignedRequest(payload), appSecret)).toEqual({
      ok: true,
      payload,
    });
  });

  it("rejects a request signed with another secret", () => {
    expect(parseSignedRequest(makeSignedRequest(payload, "other"), appSecret)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a changed payload", () => {
    const [signature] = makeSignedRequest(payload).split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, user_id: "1" })).toString("base64url");
    expect(parseSignedRequest(`${signature}.${forged}`, appSecret)).toMatchObject({
      reason: "bad_signature",
    });
  });

  it("rejects other algorithms", () => {
    expect(
      parseSignedRequest(makeSignedRequest({ ...payload, algorithm: "none" }), appSecret),
    ).toEqual({ ok: false, reason: "unsupported_algorithm" });
  });

  it.each(["", "nodot", ".payload", "sig.", "sig.not-json"])("rejects malformed %j", (value) => {
    expect(parseSignedRequest(value, appSecret)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("safeEqual", () => {
  it("compares strings and bytes of any length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(Buffer.from("x"), Buffer.from("x"))).toBe(true);
  });
});
