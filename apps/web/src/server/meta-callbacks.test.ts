import { PermanentError } from "@rc/lib/errors";
import { InvalidSignedRequestError } from "@rc/modules/instagram";
import { describe, expect, it, vi } from "vitest";
import { readSignedRequest, runMetaCallback } from "./meta-callbacks";

vi.mock("server-only", () => ({}));
const warn = vi.fn();
vi.mock("./context", () => ({ requestContext: async () => ({ logger: { warn } }) }));

const form = (fields: Record<string, string>) =>
  new Request("https://app.example.test/api/meta/deauthorize", {
    method: "POST",
    body: new URLSearchParams(fields),
  });

describe("Meta callback plumbing", () => {
  it("reads signed_request from a form and from JSON", async () => {
    expect(await readSignedRequest(form({ signed_request: "sig.payload" }))).toBe("sig.payload");
    const json = new Request("https://app.example.test/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed_request: "a.b" }),
    });
    expect(await readSignedRequest(json)).toBe("a.b");
  });

  it("returns null for anything else", async () => {
    expect(await readSignedRequest(form({ other: "x" }))).toBeNull();
    const broken = new Request("https://app.example.test/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nope",
    });
    expect(await readSignedRequest(broken)).toBeNull();
    expect(
      await readSignedRequest(new Request("https://app.example.test/x", { method: "POST" })),
    ).toBeNull();
  });

  it("passes the request through and answers 400 without a signed request", async () => {
    const run = vi.fn(async () => Response.json({ ok: true }));
    expect((await runMetaCallback(form({}), run)).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
    const ok = await runMetaCallback(form({ signed_request: "s.p" }), run);
    expect(ok.status).toBe(200);
    expect(run).toHaveBeenCalledWith(expect.anything(), "s.p");
  });

  it("answers 400 for a bad signature (without echoing it) and 503 while publishing is off", async () => {
    const bad = await runMetaCallback(form({ signed_request: "s.p" }), async () => {
      throw new InvalidSignedRequestError("bad_signature");
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_signed_request" });
    expect(warn).toHaveBeenCalledWith({ reason: "bad_signature" }, "meta callback refused");
    const off = await runMetaCallback(form({ signed_request: "s.p" }), async () => {
      throw new PermanentError("Instagram is not configured");
    });
    expect(off.status).toBe(503);
  });

  it("lets unexpected errors through", async () => {
    await expect(
      runMetaCallback(form({ signed_request: "s.p" }), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
