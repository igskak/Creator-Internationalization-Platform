import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { PermanentError } from "../errors";

/** Same shape as `env.security` (tokenEncryptionKeys + activeKeyId). */
export type KeyRing = {
  keys: ReadonlyMap<string, Uint8Array>;
  activeKeyId: string;
};

export type EncryptionOptions = {
  keyRing: KeyRing;
  /** Binds the ciphertext to its row, e.g. `social_accounts.id`; decrypting elsewhere fails. */
  aad: string;
};

const PREFIX = "enc";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM with a random 12-byte IV. Output: `enc:<keyId>:<iv>:<tag>:<ciphertext>`, base64url
 * parts (plan 12 §12.3). Always uses the active key.
 */
export function encrypt(plaintext: string, { keyRing, aad }: EncryptionOptions): string {
  const key = keyFor(keyRing, keyRing.activeKeyId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(requireAad(aad), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, keyRing.activeKeyId, b64(iv), b64(tag), b64(ciphertext)].join(":");
}

/**
 * Decrypts with the key named in the value, so values made with older keys still work after
 * rotation. Throws PermanentError for malformed input, unknown key ids, wrong AAD or tampering.
 */
export function decrypt(value: string, { keyRing, aad }: EncryptionOptions): string {
  const parsed = parse(value);
  const key = keyFor(keyRing, parsed.keyId);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(requireAad(aad), "utf8"));
    decipher.setAuthTag(parsed.tag);
    return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString("utf8");
  } catch (cause) {
    throw new PermanentError("Decryption failed: wrong key, wrong AAD or tampered value.", {
      details: { keyId: parsed.keyId },
      cause,
    });
  }
}

/** Key id a value was encrypted with; used to find values that need re-encryption. */
export function encryptedKeyId(value: string): string {
  return parse(value).keyId;
}

function parse(value: string) {
  const parts = value.split(":");
  const [prefix, keyId, iv, tag, ciphertext] = parts;
  if (
    parts.length !== 5 ||
    prefix !== PREFIX ||
    !keyId ||
    !iv ||
    !tag ||
    ciphertext === undefined
  ) {
    throw new PermanentError("Encrypted value is malformed.");
  }
  const parsed = {
    keyId,
    iv: Buffer.from(iv, "base64url"),
    tag: Buffer.from(tag, "base64url"),
    ciphertext: Buffer.from(ciphertext, "base64url"),
  };
  if (parsed.iv.length !== IV_BYTES || parsed.tag.length !== TAG_BYTES) {
    throw new PermanentError("Encrypted value is malformed.", { details: { keyId } });
  }
  return parsed;
}

function keyFor(keyRing: KeyRing, keyId: string): Uint8Array {
  const key = keyRing.keys.get(keyId);
  if (!key) {
    throw new PermanentError("Encryption key not found in the key ring.", { details: { keyId } });
  }
  if (key.length !== 32) {
    throw new PermanentError("Encryption key must be 32 bytes.", { details: { keyId } });
  }
  return key;
}

function requireAad(aad: string): string {
  if (aad.length === 0) throw new PermanentError("AAD must not be empty.");
  return aad;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
