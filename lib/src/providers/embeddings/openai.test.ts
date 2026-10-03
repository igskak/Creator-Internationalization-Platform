import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PermanentError, TransientError, ValidationError } from "../../errors";
import { createOpenAIEmbeddingProvider } from "./openai";
import { EMBEDDING_DIMENSIONS } from "./types";

// Contract tests against a mocked POST /v1/embeddings (MSW): request shape, batching, retries and
// error mapping, with no network and no cost.

const URL = "https://api.openai.com/v1/embeddings";
type Sent = {
  body: { model: string; input: string[]; dimensions: number; encoding_format: string };
  headers: Headers;
};
let sent: Sent[] = [];
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" } as never));
afterEach(() => {
  server.resetHandlers();
  sent = [];
});
afterAll(() => server.close());

const vector = (seed: number, size = EMBEDDING_DIMENSIONS) =>
  Array.from({ length: size }, (_, i) => (i === 0 ? seed : 0));
/** A handler that answers every request with one vector per input, marked with the input's index. */
const echo = (extra: { shuffle?: boolean; size?: number } = {}) =>
  server.use(
    http.post(URL, async ({ request }) => {
      const body = (await request.json()) as Sent["body"];
      sent.push({ body, headers: request.headers });
      const data = body.input.map((text, index) => ({
        object: "embedding",
        index,
        embedding: vector(Number(text.replace(/\D/g, "")) || index, extra.size),
      }));
      return HttpResponse.json({
        object: "list",
        data: extra.shuffle ? [...data].reverse() : data,
        model: body.model,
        usage: { prompt_tokens: body.input.length * 3, total_tokens: body.input.length * 3 },
      });
    }),
  );

const provider = (over: Partial<Parameters<typeof createOpenAIEmbeddingProvider>[0]> = {}) =>
  createOpenAIEmbeddingProvider({ apiKey: "sk-test-embeddings", sleep: async () => {}, ...over });

describe("request shape", () => {
  it("asks text-embedding-3-large for 1536 float dimensions with the key as a bearer token", async () => {
    echo();
    const p = provider();
    expect(p).toMatchObject({ id: "openai", model: "text-embedding-3-large", dimensions: 1536 });
    await p.embed(["a1", "b2"], { purpose: "document" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({
      model: "text-embedding-3-large",
      input: ["a1", "b2"],
      dimensions: 1536,
      encoding_format: "float",
    });
    expect(sent[0]?.headers.get("authorization")).toBe("Bearer sk-test-embeddings");
    expect(sent[0]?.headers.get("content-type")).toContain("application/json");
  });

  it("uses a custom model, dimensions and base URL when given", async () => {
    server.use(
      http.post("https://proxy.test/v1/embeddings", async ({ request }) => {
        const body = (await request.json()) as Sent["body"];
        sent.push({ body, headers: request.headers });
        return HttpResponse.json({
          data: [{ index: 0, embedding: vector(1, 256) }],
          usage: { prompt_tokens: 1 },
        });
      }),
    );
    const p = provider({
      model: "text-embedding-3-small",
      dimensions: 256,
      baseUrl: "https://proxy.test/v1/",
    });
    expect(await p.embed(["x"], { purpose: "query" })).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({ model: "text-embedding-3-small", dimensions: 256 });
  });
});

describe("results and batching", () => {
  it("returns the vectors in input order even if the API answers out of order", async () => {
    echo({ shuffle: true });
    const vectors = await provider().embed(["t1", "t2", "t3"], { purpose: "document" });
    expect(vectors.map((v) => v[0])).toEqual([1, 2, 3]);
  });

  it("returns nothing and sends nothing for an empty list", async () => {
    echo();
    expect(await provider().embed([], { purpose: "document" })).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("splits more than 2,048 texts into several requests and keeps the order", async () => {
    echo();
    const texts = Array.from({ length: 5000 }, (_, i) => `n${i + 1}`);
    const vectors = await provider().embed(texts, { purpose: "document" });
    expect(sent.map((s) => s.body.input.length)).toEqual([2048, 2048, 904]);
    expect(vectors).toHaveLength(5000);
    expect(vectors[0]?.[0]).toBe(1);
    expect(vectors[2047]?.[0]).toBe(2048);
    expect(vectors[2048]?.[0]).toBe(2049);
    expect(vectors[4999]?.[0]).toBe(5000);
  });

  it("splits by estimated tokens so one request stays under the 300,000-token limit", async () => {
    echo();
    // 20 texts of 30,000 characters = about 15,000 estimated tokens each: 16 fit in 250,000.
    const texts = Array.from({ length: 20 }, (_, i) => `${i + 1}${"x".repeat(29_990)}`);
    await provider().embed(texts, { purpose: "document" });
    expect(sent.map((s) => s.body.input.length)).toEqual([16, 4]);
  });

  it("reports the billed tokens of each request", async () => {
    echo();
    const usage: { model: string; inputTokens: number }[] = [];
    await provider({ onUsage: (u) => usage.push(u) }).embed(["a", "b", "c"], {
      purpose: "document",
    });
    expect(usage).toEqual([{ model: "text-embedding-3-large", inputTokens: 9 }]);
  });
});

describe("input checks", () => {
  it("rejects empty and oversized texts before any request", async () => {
    echo();
    const p = provider();
    await expect(p.embed(["ok", "  "], { purpose: "document" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(p.embed(["x".repeat(32_001)], { purpose: "document" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(sent).toHaveLength(0);
  });
});

describe("retries and error mapping", () => {
  const sequence = (...responses: (() => Response)[]) => {
    let i = 0;
    server.use(
      http.post(URL, async ({ request }) => {
        sent.push({ body: (await request.json()) as Sent["body"], headers: request.headers });
        return (responses[Math.min(i++, responses.length - 1)] ?? responses[0])?.() as Response;
      }),
    );
  };
  const ok = () =>
    HttpResponse.json({ data: [{ index: 0, embedding: vector(7) }], usage: { prompt_tokens: 1 } });
  const fail =
    (status: number, headers: Record<string, string> = {}) =>
    () =>
      HttpResponse.json({ error: { message: `boom ${status}`, type: "x" } }, { status, headers });

  it("retries 429 and 5xx, waiting for Retry-After when given, then succeeds", async () => {
    sequence(fail(429, { "retry-after": "3" }), fail(503), ok);
    const waits: number[] = [];
    const result = await provider({ sleep: async (ms) => void waits.push(ms) }).embed(["x"], {
      purpose: "document",
    });
    expect(result[0]?.[0]).toBe(7);
    expect(sent).toHaveLength(3);
    expect(waits[0]).toBe(3000);
    expect(waits[1]).toBeGreaterThanOrEqual(1000); // backoff 500 × 2 + jitter
    expect(waits[1]).toBeLessThan(1300);
  });

  it("gives up after the retries with a TransientError (rate limited for 429)", async () => {
    sequence(fail(429, { "retry-after": "5" }));
    const error = (await provider({ maxRetries: 2 })
      .embed(["x"], { purpose: "document" })
      .catch((e: unknown) => e)) as TransientError;
    expect(error).toBeInstanceOf(TransientError);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterMs).toBe(5000);
    expect(sent).toHaveLength(3); // first try + 2 retries

    sent = [];
    sequence(fail(500));
    const server500 = (await provider({ maxRetries: 1 })
      .embed(["x"], { purpose: "document" })
      .catch((e: unknown) => e)) as TransientError;
    expect(server500).toBeInstanceOf(TransientError);
    expect(server500.code).toBe("EXTERNAL_ERROR");
    expect(sent).toHaveLength(2);
  });

  it.each([400, 401, 403, 404])(
    "does not retry %i and maps it to a PermanentError",
    async (status) => {
      sequence(fail(status));
      const error = await provider()
        .embed(["x"], { purpose: "document" })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PermanentError);
      expect((error as PermanentError).message).toContain(`boom ${status}`);
      expect(sent).toHaveLength(1);
    },
  );

  it("retries network failures and then maps them to a TransientError", async () => {
    let calls = 0;
    server.use(
      http.post(URL, () => {
        calls += 1;
        return calls < 3 ? HttpResponse.error() : ok();
      }),
    );
    expect((await provider().embed(["x"], { purpose: "document" }))[0]?.[0]).toBe(7);
    expect(calls).toBe(3);

    server.use(http.post(URL, () => HttpResponse.error()));
    await expect(
      provider({ maxRetries: 1 }).embed(["x"], { purpose: "document" }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("rejects an answer with the wrong number or size of vectors", async () => {
    server.use(
      http.post(URL, () =>
        HttpResponse.json({ data: [{ index: 0, embedding: vector(1, 3072) }], usage: {} }),
      ),
    );
    await expect(provider().embed(["x"], { purpose: "document" })).rejects.toBeInstanceOf(
      PermanentError,
    );
    server.use(http.post(URL, () => HttpResponse.json({ data: [], usage: {} })));
    await expect(provider().embed(["x"], { purpose: "document" })).rejects.toBeInstanceOf(
      PermanentError,
    );
  });

  it("does not put the API key into error messages", async () => {
    sequence(fail(401));
    const error = (await provider()
      .embed(["x"], { purpose: "document" })
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain("sk-test-embeddings");
  });
});
