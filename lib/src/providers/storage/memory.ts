import { NotFoundError } from "../../errors";
import type { ObjectInfo, StorageProvider } from "./types";

type Stored = { bytes: Uint8Array; contentType: string; lastModified: Date };

/**
 * In-process storage for tests and E2E (`STORAGE_PROVIDER=memory`). Presigned URLs use the
 * `memory://` scheme and cannot be fetched; tests use put/getBytes directly.
 */
export function createMemoryStorage(options: { now?: () => Date } = {}): StorageProvider & {
  keys(): string[];
} {
  const now = options.now ?? (() => new Date());
  const objects = new Map<string, Stored>();

  const find = (key: string): Stored => {
    const found = objects.get(key);
    if (!found) throw new NotFoundError("Object not found.", { details: { key } });
    return found;
  };
  const expiresAt = (seconds: number) => new Date(now().getTime() + seconds * 1000);
  const url = (key: string, op: string, seconds: number) =>
    `memory://storage/${encodeURI(key)}?op=${op}&expires=${expiresAt(seconds).toISOString()}`;

  return {
    async presignPut(key, { contentType, expiresInSeconds }) {
      return {
        url: url(key, "put", expiresInSeconds),
        headers: { "Content-Type": contentType },
        expiresAt: expiresAt(expiresInSeconds),
      };
    },
    async presignGet(key, { expiresInSeconds }) {
      return { url: url(key, "get", expiresInSeconds), expiresAt: expiresAt(expiresInSeconds) };
    },
    async head(key): Promise<ObjectInfo | null> {
      const found = objects.get(key);
      if (!found) return null;
      return {
        size: found.bytes.byteLength,
        contentType: found.contentType,
        etag: undefined,
        lastModified: found.lastModified,
      };
    },
    async getStream(key) {
      const bytes = find(key).bytes.slice();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    },
    async getBytes(key) {
      return find(key).bytes.slice();
    },
    async put(key, body, { contentType }) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body.slice();
      objects.set(key, { bytes, contentType, lastModified: now() });
    },
    async delete(key) {
      objects.delete(key);
    },
    keys: () => [...objects.keys()].sort(),
  };
}
