import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PermanentError, TransientError, ValidationError } from "../../errors";
import { createFakeImageProvider, createImageProvider, createOpenAIImageProvider } from "./index";

// Contract tests against a mocked POST /v1/images/generations (MSW) and tests of the fake.

const URL = "https://api.openai.com/v1/images/generations";
let sent: { body: Record<string, unknown>; headers: Headers }[] = [];
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" } as never));
afterEach(() => {
  server.resetHandlers();
  sent = [];
});
afterAll(() => server.close());

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ok = () =>
  server.use(
    http.post(URL, async ({ request }) => {
      sent.push({
        body: (await request.json()) as Record<string, unknown>,
        headers: request.headers,
      });
      return HttpResponse.json({ data: [{ b64_json: PNG.toString("base64") }], usage: {} });
    }),
  );
const provider = (over: Partial<Parameters<typeof createOpenAIImageProvider>[0]> = {}) =>
  createOpenAIImageProvider({ apiKey: "sk-test-images", sleep: async () => {}, ...over });

describe("OpenAI image provider", () => {
  it("sends a portrait request and returns the decoded image with an estimated cost", async () => {
    ok();
    const image = await provider().generate({
      prompt: "Macro rice",
      negativePrompt: "text, logos",
      aspect: "4:5",
    });
    expect(sent[0]?.body).toEqual({
      model: "gpt-image-2.5-flare",
      size: "1024x1536",
      quality: "high",
      output_format: "png",
      n: 1,
      prompt: "Macro rice\n\nAvoid: text, logos",
    });
    expect(sent[0]?.headers.get("authorization")).toBe("Bearer sk-test-images");
    expect(Buffer.from(image.bytes)).toEqual(PNG);
    expect(image).toMatchObject({
      mimeType: "image/png",
      width: 1024,
      height: 1536,
      costUsd: 0.19,
    });
    expect(image.params).toMatchObject({ size: "1024x1536" });
  });

  it("maps the aspects to sizes and uses the quality and prices it is given", async () => {
    ok();
    const p = provider({ quality: "low", prices: { low: 0.5 } });
    expect((await p.generate({ prompt: "x", aspect: "1:1" })).costUsd).toBe(0.5);
    await p.generate({ prompt: "x", aspect: "16:9" });
    expect(sent.map((s) => s.body.size)).toEqual(["1024x1024", "1536x1024"]);
    expect(
      (await provider({ quality: "auto" }).generate({ prompt: "x", aspect: "1:1" })).costUsd,
    ).toBeNull();
  });

  it("rejects an empty prompt before any request", async () => {
    await expect(provider().generate({ prompt: " ", aspect: "1:1" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(sent).toEqual([]);
  });

  it("retries a 429 and a 500, then gives up with a TransientError", async () => {
    let calls = 0;
    server.use(
      http.post(URL, () => {
        calls++;
        return calls < 3
          ? HttpResponse.json(
              { error: { message: "slow down" } },
              { status: calls === 1 ? 429 : 500 },
            )
          : HttpResponse.json({ data: [{ b64_json: PNG.toString("base64") }] });
      }),
    );
    await provider().generate({ prompt: "x", aspect: "1:1" });
    expect(calls).toBe(3);

    server.use(
      http.post(URL, () => HttpResponse.json({ error: { message: "x" } }, { status: 503 })),
    );
    await expect(
      provider({ maxRetries: 1 }).generate({ prompt: "x", aspect: "1:1" }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("treats a moderation block and a bad request as permanent", async () => {
    server.use(
      http.post(URL, () =>
        HttpResponse.json(
          { error: { code: "moderation_blocked", message: "blocked" } },
          { status: 400 },
        ),
      ),
    );
    const error = await provider()
      .generate({ prompt: "x", aspect: "1:1" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermanentError);
    expect((error as Error).message).toContain("moderation");
    expect(JSON.stringify(error)).not.toContain("sk-test-images");
  });

  it("fails when the answer has no image", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ data: [] })));
    await expect(provider().generate({ prompt: "x", aspect: "1:1" })).rejects.toBeInstanceOf(
      PermanentError,
    );
  });
});

describe("fake image provider", () => {
  it("makes a deterministic PNG per prompt, with the label inside, and records calls", async () => {
    const fake = createFakeImageProvider();
    const a = await fake.generate({ prompt: "one", aspect: "4:5", label: "hero" });
    const again = await fake.generate({ prompt: "one", aspect: "4:5", label: "hero" });
    const b = await fake.generate({ prompt: "two", aspect: "4:5", label: "hero" });
    expect(Buffer.from(a.bytes)).toEqual(Buffer.from(again.bytes));
    expect(Buffer.from(a.bytes)).not.toEqual(Buffer.from(b.bytes));
    expect(Buffer.from(a.bytes).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(Buffer.from(a.bytes).includes("label\0hero")).toBe(true);
    expect(a).toMatchObject({ width: 256, height: 320, costUsd: 0, mimeType: "image/png" });
    expect(fake.calls).toHaveLength(3);
  });

  it("can be told to fail, and the factory picks it from the config", async () => {
    const fake = createFakeImageProvider({
      fail: (_r, n) => (n === 2 ? new Error("boom") : undefined),
    });
    await fake.generate({ prompt: "x", aspect: "1:1" });
    await expect(fake.generate({ prompt: "x", aspect: "1:1" })).rejects.toThrow("boom");
    expect(createImageProvider({ provider: "fake" }).id).toBe("fake");
    expect(createImageProvider({ provider: "live", openaiApiKey: "k" }).id).toBe("openai");
  });
});
