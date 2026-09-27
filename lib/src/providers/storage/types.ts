/**
 * Object storage (plan 01 D-06): one private bucket per environment, reached only through
 * presigned URLs from the outside. Implementations: R2 (S3 API) and in-memory (tests).
 */
export type StorageProvider = {
  /** URL the browser PUTs the file to; send `headers` with the request. */
  presignPut(key: string, options: PresignPutOptions): Promise<PresignedUpload>;
  presignGet(key: string, options: PresignGetOptions): Promise<PresignedDownload>;
  /** Metadata, or null if the object does not exist. */
  head(key: string): Promise<ObjectInfo | null>;
  /** Throws NotFoundError if the object does not exist. */
  getStream(key: string): Promise<ReadableStream<Uint8Array>>;
  /** Throws NotFoundError if the object does not exist. */
  getBytes(key: string): Promise<Uint8Array>;
  put(key: string, body: Uint8Array | string, options: PutOptions): Promise<void>;
  /** No error if the object does not exist. */
  delete(key: string): Promise<void>;
};

export type PresignPutOptions = {
  /** Signed: an upload with another Content-Type is rejected. */
  contentType: string;
  /** Declared size; also checked with head() when the upload completes. */
  contentLength?: number;
  expiresInSeconds: number;
};

export type PresignGetOptions = {
  expiresInSeconds: number;
  /** Sets Content-Disposition: attachment with this file name. */
  downloadFileName?: string;
};

export type PresignedUpload = { url: string; headers: Record<string, string>; expiresAt: Date };
export type PresignedDownload = { url: string; expiresAt: Date };

export type ObjectInfo = {
  size: number;
  contentType: string | undefined;
  etag: string | undefined;
  lastModified: Date | undefined;
};

export type PutOptions = { contentType: string };

/** Presigned URL lifetimes in seconds (plan 12 §12.4). */
export const PRESIGN_TTL = {
  upload: 15 * 60,
  sourceDownload: 10 * 60,
  preview: 30 * 60,
  metaFetch: 2 * 60 * 60,
} as const;
