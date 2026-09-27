import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { storageContract } from "./contract";
import { createR2Storage, type R2Config } from "./r2";

// Live test against a real R2 bucket. Runs only with R2_LIVE_TEST=1 and the R2_* variables set;
// writes under tmp/contract-test/<uuid>/ and deletes what it wrote. Use a dev bucket.
const env = process.env;
const config: R2Config | undefined =
  env.R2_LIVE_TEST === "1" &&
  env.R2_ACCOUNT_ID &&
  env.R2_ACCESS_KEY_ID &&
  env.R2_SECRET_ACCESS_KEY &&
  env.R2_BUCKET
    ? {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
        jurisdiction: env.R2_JURISDICTION === "eu" ? "eu" : undefined,
      }
    : undefined;

const prefix = `tmp/contract-test/${randomUUID()}`;

describe.skipIf(!config)("R2 live", () => {
  const storage = config ? createR2Storage(config) : undefined;
  const make = () => {
    if (!storage) throw new Error("R2 not configured");
    return storage;
  };

  storageContract("r2", make, prefix);

  it("accepts a presigned PUT with the signed type and length, rejects others (V-22)", async () => {
    const body = new TextEncoder().encode("%PDF-1.7 synthetic");
    const key = `${prefix}/upload.pdf`;
    const upload = await make().presignPut(key, {
      contentType: "application/pdf",
      contentLength: body.byteLength,
      expiresInSeconds: 60,
    });

    const wrongType = await fetch(upload.url, {
      method: "PUT",
      body,
      headers: { "Content-Type": "text/plain" },
    });
    expect(wrongType.status).toBe(403);

    const wrongLength = await fetch(upload.url, {
      method: "PUT",
      body: new Uint8Array([...body, 1]),
      headers: upload.headers,
    });
    expect(wrongLength.status).toBe(403);

    const ok = await fetch(upload.url, { method: "PUT", body, headers: upload.headers });
    expect(ok.status).toBe(200);
    expect((await make().head(key))?.size).toBe(body.byteLength);

    const download = await make().presignGet(key, { expiresInSeconds: 60 });
    const got = await fetch(download.url);
    expect(await got.text()).toBe("%PDF-1.7 synthetic");
    await make().delete(key);
  });

  afterAll(async () => {
    if (!storage) return;
    for (const name of ["a.txt", "b.bin", "c.txt", "d.txt", "upload.pdf"]) {
      await storage.delete(`${prefix}/${name}`);
    }
  });
});
