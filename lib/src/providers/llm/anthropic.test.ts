import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { PermanentError, TransientError } from "../../errors";
import { createAnthropicProvider, FALLBACK_BETA } from "./anthropic";
import type { StructuredRequest } from "./types";

// Contract tests: the adapter talks to a mocked Messages API (MSW), so they check the request
// shape and how responses and errors are mapped, without network or cost.

const URL = "https://api.anthropic.com/v1/messages";
const Output = z.object({ ideas: z.array(z.string()) });

type Sent = { body: Record<string, unknown>; headers: Headers };
let sent: Sent[] = [];
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" } as never));
afterEach(() => {
  server.resetHandlers();
  sent = [];
});
afterAll(() => server.close());

const message = (over: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content: [{ type: "text", text: JSON.stringify({ ideas: ["a", "b"] }) }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_input_tokens: 50,
    cache_creation_input_tokens: 10,
  },
  ...over,
});

const reply = (...bodies: Record<string, unknown>[]) => {
  let i = 0;
  server.use(
    http.post(URL, async ({ request }) => {
      sent.push({
        body: (await request.json()) as Record<string, unknown>,
        headers: request.headers,
      });
      const body = bodies[Math.min(i++, bodies.length - 1)] ?? message();
      return HttpResponse.json(body, { headers: { "request-id": "req_abc" } });
    }),
  );
};

const request = (
  over: Partial<StructuredRequest<z.infer<typeof Output>>> = {},
): StructuredRequest<z.infer<typeof Output>> => ({
  model: "claude-opus-5",
  system: [
    { text: "Rules.", cache: false },
    { text: "Writer rules.", cache: true },
  ],
  messages: [{ role: "user", content: [{ type: "text", text: "Give ideas." }] }],
  schema: Output,
  schemaName: "ideas",
  effort: "high",
  maxTokens: 4000,
  meta: { stage: "IDEA_GENERATION", promptId: "idea-generator", promptVersion: 1 },
  ...over,
});
const provider = (options: { fallback?: "default" | false; maxRetries?: number } = {}) =>
  createAnthropicProvider({ apiKey: "sk-ant-test-key", maxRetries: 0, ...options });

describe("request shape", () => {
  it("sends adaptive thinking, effort and a JSON schema format, and never temperature", async () => {
    reply(message());
    await provider().generateStructured(request());
    const body = sent[0]?.body ?? {};
    expect(body).toMatchObject({
      model: "claude-opus-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema" } },
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
    const format = (body.output_config as { format: { schema: Record<string, unknown> } }).format;
    expect(format.schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("marks cache breakpoints on system blocks and sends text, PDF and image content", async () => {
    reply(message());
    await provider().generateStructured(
      request({
        messages: [
          {
            role: "user",
            content: [
              { type: "pdf", base64: "UERG", title: "Guide" },
              { type: "image", base64: "SU1H", mediaType: "image/png" },
              { type: "text", text: "Extract." },
            ],
          },
        ],
      }),
    );
    const body = sent[0]?.body as {
      system: Record<string, unknown>[];
      messages: { role: string; content: Record<string, unknown>[] }[];
    };
    expect(body.system).toEqual([
      { type: "text", text: "Rules." },
      { type: "text", text: "Writer rules.", cache_control: { type: "ephemeral" } },
    ]);
    expect(body.messages[0]?.content).toEqual([
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "UERG" },
        title: "Guide",
      },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "SU1H" } },
      { type: "text", text: "Extract." },
    ]);
    expect(JSON.stringify(body)).not.toContain("citations");
  });

  it("opts into the server-side refusal fallback, and not when disabled", async () => {
    reply(message());
    await provider().generateStructured(request());
    expect(sent[0]?.body.fallbacks).toBe("default");
    expect(sent[0]?.headers.get("anthropic-beta")).toContain(FALLBACK_BETA);

    await provider({ fallback: false }).generateStructured(request());
    expect(sent[1]?.body).not.toHaveProperty("fallbacks");
    expect(sent[1]?.headers.get("anthropic-beta") ?? "").not.toContain(FALLBACK_BETA);
  });

  it("omits effort when the request has none and uses the key header", async () => {
    reply(message());
    const { effort: _effort, ...noEffort } = request();
    await provider().generateStructured(noEffort);
    const config = sent[0]?.body.output_config as Record<string, unknown>;
    expect(config).not.toHaveProperty("effort");
    expect(sent[0]?.headers.get("x-api-key")).toBe("sk-ant-test-key");
  });
});

describe("results", () => {
  it("returns parsed data, usage including cache tokens, model and request id", async () => {
    reply(message());
    const result = await provider().generateStructured(request());
    expect(result).toMatchObject({
      data: { ideas: ["a", "b"] },
      stopReason: "end_turn",
      model: "claude-opus-5",
      requestId: "req_abc",
      fallbackRan: false,
      retriedForMaxTokens: false,
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 10 },
    });
    expect(result.validationError).toBeUndefined();
  });

  it("reports output that is not JSON or does not match the schema as data null", async () => {
    reply(message({ content: [{ type: "text", text: "Sure! Here you go" }] }));
    const bad = await provider().generateStructured(request());
    expect(bad.data).toBeNull();
    expect(bad.validationError).toContain("not valid JSON");
    expect(bad.rawText).toBe("Sure! Here you go");

    reply(message({ content: [{ type: "text", text: '{"ideas":"nope"}' }] }));
    const mismatch = await provider().generateStructured(request());
    expect(mismatch.data).toBeNull();
    expect(mismatch.validationError).toContain("ideas");
  });

  it("returns a refusal with its category instead of data", async () => {
    reply(
      message({
        content: [],
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: "declined" },
      }),
    );
    const result = await provider().generateStructured(request());
    expect(result).toMatchObject({
      data: null,
      stopReason: "refusal",
      refusal: { category: "cyber", explanation: "declined" },
    });
  });

  it("flags a fallback model answer and reports the model that answered", async () => {
    reply(
      message({
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          iterations: [{ type: "message" }, { type: "fallback_message" }],
        },
      }),
    );
    const result = await provider().generateStructured(request());
    expect(result).toMatchObject({ fallbackRan: true, model: "claude-opus-4-8" });
  });

  it("retries once with a doubled limit after max_tokens and sums the usage", async () => {
    reply(
      message({
        content: [{ type: "text", text: '{"ideas":["a"' }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 100, output_tokens: 4000 },
      }),
      message({ usage: { input_tokens: 100, output_tokens: 30 } }),
    );
    const result = await provider().generateStructured(request());
    expect(sent.map((s) => s.body.max_tokens)).toEqual([4000, 8000]);
    expect(result).toMatchObject({
      data: { ideas: ["a", "b"] },
      retriedForMaxTokens: true,
      usage: { inputTokens: 200, outputTokens: 4030 },
    });
  });

  it("gives up after the second truncation without data", async () => {
    const truncated = message({
      content: [{ type: "text", text: '{"ideas":["a"' }],
      stop_reason: "max_tokens",
    });
    reply(truncated, truncated);
    const result = await provider().generateStructured(request());
    expect(sent).toHaveLength(2);
    expect(result).toMatchObject({
      data: null,
      stopReason: "max_tokens",
      retriedForMaxTokens: true,
    });
  });
});

describe("streaming", () => {
  const sse = (events: [string, unknown][]) =>
    events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");

  it("streams, assembles the final message and validates the text with the schema", async () => {
    const text = JSON.stringify({ ideas: ["x"] });
    server.use(
      http.post(URL, async ({ request: req }) => {
        sent.push({ body: (await req.json()) as Record<string, unknown>, headers: req.headers });
        return new HttpResponse(
          sse([
            [
              "message_start",
              {
                type: "message_start",
                message: message({ content: [], usage: { input_tokens: 10, output_tokens: 1 } }),
              },
            ],
            [
              "content_block_start",
              { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            ],
            [
              "content_block_delta",
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: text.slice(0, 8) },
              },
            ],
            [
              "content_block_delta",
              {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: text.slice(8) },
              },
            ],
            ["content_block_stop", { type: "content_block_stop", index: 0 }],
            [
              "message_delta",
              {
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { output_tokens: 12 },
              },
            ],
            ["message_stop", { type: "message_stop" }],
          ]),
          { headers: { "content-type": "text/event-stream", "request-id": "req_stream" } },
        );
      }),
    );
    const result = await provider().generateStructured(request({ stream: true }));
    expect(sent[0]?.body.stream).toBe(true);
    expect(result).toMatchObject({
      data: { ideas: ["x"] },
      stopReason: "end_turn",
      usage: { outputTokens: 12 },
    });
  });
});

describe("error mapping", () => {
  const fail = (status: number, headers: Record<string, string> = {}) =>
    server.use(
      http.post(URL, () =>
        HttpResponse.json(
          { type: "error", error: { type: "api_error", message: `boom ${status}` } },
          { status, headers },
        ),
      ),
    );
  const error = async () =>
    provider()
      .generateStructured(request())
      .then(
        () => expect.unreachable("expected an error"),
        (e: unknown) => e,
      );

  it("maps 429 to a rate-limited TransientError with retry-after", async () => {
    fail(429, { "retry-after": "7" });
    const e = (await error()) as TransientError;
    expect(e).toBeInstanceOf(TransientError);
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.retryAfterMs).toBe(7000);
  });

  it.each([500, 502, 529])("maps %i to a TransientError", async (status) => {
    fail(status);
    const e = (await error()) as TransientError;
    expect(e).toBeInstanceOf(TransientError);
    expect(e.code).toBe("EXTERNAL_ERROR");
    expect(e.details).toMatchObject({ status });
  });

  it.each([400, 401, 403, 404])("maps %i to a PermanentError", async (status) => {
    fail(status);
    const e = await error();
    expect(e).toBeInstanceOf(PermanentError);
    expect(e).not.toBeInstanceOf(TransientError);
  });

  it("maps network failures to a TransientError", async () => {
    server.use(http.post(URL, () => HttpResponse.error()));
    expect(await error()).toBeInstanceOf(TransientError);
  });

  it("does not leak the API key into error messages", async () => {
    fail(401);
    expect(String(((await error()) as Error).message)).not.toContain("sk-ant-test-key");
  });
});
