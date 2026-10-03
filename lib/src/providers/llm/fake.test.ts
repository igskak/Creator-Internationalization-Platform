import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PermanentError } from "../../errors";
import { createFakeLLMProvider, fakeFixtureKey } from "./fake";
import { llmInputHash } from "./hash";
import type { StructuredRequest } from "./types";

const Output = z.object({ ideas: z.array(z.string()) });
const request = (text = "Give ideas."): StructuredRequest<z.infer<typeof Output>> => ({
  model: "m",
  system: [{ text: "Rules." }],
  messages: [{ role: "user", content: [{ type: "text", text }] }],
  schema: Output,
  schemaName: "ideas",
  maxTokens: 100,
  meta: { stage: "IDEA_GENERATION", promptId: "idea-generator", promptVersion: 1 },
});

describe("llmInputHash", () => {
  it("is stable and changes with model, system, content, binaries and effort", () => {
    const base = request();
    expect(llmInputHash(base)).toBe(llmInputHash(request()));
    expect(llmInputHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(llmInputHash(request("other"))).not.toBe(llmInputHash(base));
    expect(llmInputHash({ ...base, model: "n" })).not.toBe(llmInputHash(base));
    expect(llmInputHash({ ...base, effort: "low" })).not.toBe(llmInputHash(base));
    expect(llmInputHash({ ...base, system: [{ text: "Rules.", cache: true }] })).not.toBe(
      llmInputHash(base),
    );
    const withPdf = (b64: string) => ({
      ...base,
      messages: [{ role: "user" as const, content: [{ type: "pdf" as const, base64: b64 }] }],
    });
    expect(llmInputHash(withPdf("AAAA"))).not.toBe(llmInputHash(withPdf("BBBB")));
  });
});

describe("FakeLLMProvider", () => {
  it("answers from a fixture keyed by prompt id and input hash and records the call", async () => {
    const req = request();
    const fake = createFakeLLMProvider({ fixtures: { [fakeFixtureKey(req)]: { ideas: ["a"] } } });
    const result = await fake.generateStructured(req);
    expect(result).toMatchObject({
      data: { ideas: ["a"] },
      stopReason: "end_turn",
      fallbackRan: false,
    });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(fake.calls).toEqual([req]);
    expect(fake.id).toBe("fake");
  });

  it("fails loudly when no fixture matches", async () => {
    const fake = createFakeLLMProvider({ fixtures: {} });
    await expect(fake.generateStructured(request())).rejects.toBeInstanceOf(PermanentError);
  });

  it("returns null data with a validation error for wrong or non-JSON output", async () => {
    const wrong = await createFakeLLMProvider({ handler: () => ({ ideas: 1 }) }).generateStructured(
      request(),
    );
    expect(wrong.data).toBeNull();
    expect(wrong.validationError).toContain("ideas");
    const raw = await createFakeLLMProvider({
      handler: () => ({ rawText: "nope" }),
    }).generateStructured(request());
    expect(raw).toMatchObject({ data: null, rawText: "nope" });
    expect(raw.validationError).toContain("not valid JSON");
  });

  it("simulates refusal, truncation and errors, and passes the call index to the handler", async () => {
    const seen: number[] = [];
    const fake = createFakeLLMProvider({
      handler: (_req, i) => {
        seen.push(i);
        if (i === 0) return { refusal: { category: "cyber" } };
        if (i === 1) return { maxTokens: true };
        if (i === 2) return { error: new Error("down") };
        return { ideas: ["ok"] };
      },
    });
    expect(await fake.generateStructured(request())).toMatchObject({
      data: null,
      stopReason: "refusal",
      refusal: { category: "cyber", explanation: null },
    });
    expect(await fake.generateStructured(request())).toMatchObject({
      data: null,
      stopReason: "max_tokens",
    });
    await expect(fake.generateStructured(request())).rejects.toThrow("down");
    expect((await fake.generateStructured(request())).data).toEqual({ ideas: ["ok"] });
    expect(seen).toEqual([0, 1, 2, 3]);
  });
});
