import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NotFoundError, PermanentError, TransientError } from "../../errors";
import type { StorageProvider } from "./types";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** `eu` for EU-jurisdiction buckets; they are only reachable on the `.eu.` endpoint. */
  jurisdiction?: "eu" | undefined;
};

export function r2Endpoint(accountId: string, jurisdiction?: "eu"): string {
  return `https://${accountId}${jurisdiction ? `.${jurisdiction}` : ""}.r2.cloudflarestorage.com`;
}

export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto", // required by the SDK, ignored by R2
    endpoint: r2Endpoint(config.accountId, config.jurisdiction),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Do not add CRC checksums by default: presigned browser PUTs would need checksum headers.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** R2 through the S3 API (plan 01 D-06). Presigned URLs work only on the S3 API domain (V-22). */
export function createR2Storage(
  config: R2Config,
  client: Pick<S3Client, "send"> = createR2Client(config),
): StorageProvider {
  const Bucket = config.bucket;
  const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000);
  const presigner = client as S3Client;

  return {
    async presignPut(key, { contentType, contentLength, expiresInSeconds }) {
      const command = new PutObjectCommand({
        Bucket,
        Key: key,
        ContentType: contentType,
        ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
      });
      const signableHeaders = new Set(["content-type"]);
      if (contentLength !== undefined) signableHeaders.add("content-length");
      const url = await getSignedUrl(presigner, command, {
        expiresIn: expiresInSeconds,
        signableHeaders,
      });
      return {
        url,
        headers: { "Content-Type": contentType },
        expiresAt: expiresAt(expiresInSeconds),
      };
    },

    async presignGet(key, { expiresInSeconds, downloadFileName }) {
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ...(downloadFileName
          ? {
              ResponseContentDisposition: `attachment; filename="${downloadFileName.replace(/["\\]/g, "_")}"`,
            }
          : {}),
      });
      const url = await getSignedUrl(presigner, command, { expiresIn: expiresInSeconds });
      return { url, expiresAt: expiresAt(expiresInSeconds) };
    },

    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          size: out.ContentLength ?? 0,
          contentType: out.ContentType,
          etag: out.ETag,
          lastModified: out.LastModified,
        };
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw mapS3Error(error, "head", key);
      }
    },

    async getStream(key) {
      const body = await getBody(key);
      return body.transformToWebStream() as ReadableStream<Uint8Array>;
    },

    async getBytes(key) {
      const body = await getBody(key);
      return body.transformToByteArray();
    },

    async put(key, body, { contentType }) {
      try {
        await client.send(
          new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
        );
      } catch (error) {
        throw mapS3Error(error, "put", key);
      }
    },

    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      } catch (error) {
        if (statusOf(error) === 404) return;
        throw mapS3Error(error, "delete", key);
      }
    },
  };

  async function getBody(key: string) {
    try {
      const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!out.Body) throw new NotFoundError("Object has no body.", { details: { key } });
      return out.Body;
    } catch (error) {
      throw mapS3Error(error, "get", key);
    }
  }
}

function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

/** 404 → NotFound; 429, 5xx and network errors → Transient; everything else → Permanent. */
export function mapS3Error(error: unknown, operation: string, key: string): Error {
  if (error instanceof NotFoundError) return error;
  const status = statusOf(error);
  const name = (error as { name?: string })?.name ?? "Error";
  const details = { operation, key, status, s3Error: name };
  if (status === 404 || name === "NoSuchKey" || name === "NotFound") {
    return new NotFoundError("Object not found.", { details, cause: error });
  }
  if (status === undefined || status === 429 || status >= 500) {
    return new TransientError(`Storage ${operation} failed.`, {
      details,
      cause: error,
      rateLimited: status === 429,
    });
  }
  return new PermanentError(`Storage ${operation} was rejected (${status}).`, {
    details,
    cause: error,
  });
}
