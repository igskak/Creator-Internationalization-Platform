import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { NotFoundError, PermanentError, TransientError } from "../../errors";
import { createR2Storage, mapS3Error, r2Endpoint } from "./r2";

// Offline tests: presigning needs no network; `send` is stubbed.

const config = {
  accountId: "0123456789abcdef0123456789abcdef",
  accessKeyId: "AKIASYNTHETIC",
  secretAccessKey: "synthetic-secret-access-key",
  bucket: "regchef-dev",
  jurisdiction: "eu" as const,
};

function s3Error(name: string, status: number) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

function stubClient(fail: unknown): Pick<S3Client, "send"> {
  return { send: (async () => Promise.reject(fail)) as unknown as S3Client["send"] };
}

describe("r2Endpoint", () => {
  it("uses the .eu. host for EU-jurisdiction buckets", () => {
    expect(r2Endpoint("acc")).toBe("https://acc.r2.cloudflarestorage.com");
    expect(r2Endpoint("acc", "eu")).toBe("https://acc.eu.r2.cloudflarestorage.com");
  });
});

describe("createR2Storage presigning", () => {
  const storage = createR2Storage(config);

  it("signs PUT with content type and length on the EU endpoint", async () => {
    const upload = await storage.presignPut("sources/s1/book.pdf", {
      contentType: "application/pdf",
      contentLength: 1234,
      expiresInSeconds: 900,
    });
    const url = new URL(upload.url);
    expect(url.host).toBe(`regchef-dev.${config.accountId}.eu.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe("/sources/s1/book.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
      expect.arrayContaining(["content-length", "content-type", "host"]),
    );
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(url.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(false);
    expect(upload.headers).toEqual({ "Content-Type": "application/pdf" });
  });

  it("signs GET with an attachment file name", async () => {
    const download = await storage.presignGet("sources/s1/book.pdf", {
      expiresInSeconds: 600,
      downloadFileName: 'my "book".pdf',
    });
    const url = new URL(download.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("response-content-disposition")).toBe(
      'attachment; filename="my _book_.pdf"',
    );
  });
});

describe("createR2Storage errors", () => {
  it("maps a missing object to null on head and NotFoundError on read", async () => {
    const storage = createR2Storage(config, stubClient(s3Error("NotFound", 404)));
    expect(await storage.head("x")).toBeNull();
    const reading = createR2Storage(config, stubClient(s3Error("NoSuchKey", 404)));
    await expect(reading.getBytes("x")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ignores 404 on delete", async () => {
    const storage = createR2Storage(config, stubClient(s3Error("NoSuchKey", 404)));
    await expect(storage.delete("x")).resolves.toBeUndefined();
  });

  it.each([
    [s3Error("SlowDown", 429), TransientError, "RATE_LIMITED"],
    [s3Error("InternalError", 500), TransientError, "EXTERNAL_ERROR"],
    [new Error("socket hang up"), TransientError, "EXTERNAL_ERROR"],
    [s3Error("AccessDenied", 403), PermanentError, "EXTERNAL_ERROR"],
  ])("maps %s", (error, type, code) => {
    const mapped = mapS3Error(error, "put", "k");
    expect(mapped).toBeInstanceOf(type);
    expect((mapped as TransientError).code).toBe(code);
  });

  it("does not put credentials into error details", async () => {
    const storage = createR2Storage(config, stubClient(s3Error("AccessDenied", 403)));
    const error = (await storage
      .put("k", "x", { contentType: "text/plain" })
      .catch((e) => e)) as PermanentError;
    expect(JSON.stringify(error.details)).not.toContain(config.secretAccessKey);
    expect(error.details).toMatchObject({ operation: "put", key: "k", status: 403 });
  });
});
