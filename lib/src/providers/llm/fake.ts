import { PermanentError } from "../../errors";
import { llmInputHash } from "./hash";
import type { LLMProvider, StructuredRequest, StructuredResult } from "./types";

// FakeLLMProvider (plan 07 §7.3): fixtures keyed by `promptId:inputHash`, or a handler for tests
// that need to react to the request. No network, no cost.

/** What a fake call answers with. Plain data is the model's JSON output. */
export type FakeResponse =
  | { data: unknown }
  | { rawText: string }
  | { refusal: { category?: string | null; explanation?: string | null } }
  | { maxTokens: true }
  | { error: Error };

export type FakeLLMOptions = {
  /** `promptId:inputHash` → data; build keys with `fakeFixtureKey`. */
  fixtures?: Record<string, unknown>;
  /** Wins over fixtures. `callIndex` counts from 0 over this provider's calls. */
  handler?: (request: StructuredRequest<unknown>, callIndex: number) => FakeResponse | unknown;
  model?: string;
};

export const fakeFixtureKey = (
  request: Pick<StructuredRequest<unknown>, "meta" | "model" | "system" | "messages" | "effort">,
) => `${request.meta.promptId}:${llmInputHash(request)}`;

const isResponse = (value: unknown): value is FakeResponse =>
  typeof value === "object" &&
  value !== null &&
  ["data", "rawText", "refusal", "maxTokens", "error"].some((key) => key in value);

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function createFakeLLMProvider(options: FakeLLMOptions = {}): LLMProvider & {
  /** Requests received, in order. */
  readonly calls: StructuredRequest<unknown>[];
} {
  const calls: StructuredRequest<unknown>[] = [];
  return {
    id: "fake",
    calls,
    async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const callIndex = calls.length;
      calls.push(request as StructuredRequest<unknown>);

      let answer: FakeResponse;
      if (options.handler) {
        const value = options.handler(request as StructuredRequest<unknown>, callIndex);
        answer = isResponse(value) ? value : { data: value };
      } else {
        const key = fakeFixtureKey(request);
        const fixtures = options.fixtures ?? {};
        if (!(key in fixtures)) {
          throw new PermanentError(`No fake LLM fixture for ${key}.`, { details: { key } });
        }
        answer = { data: fixtures[key] };
      }
      if ("error" in answer) throw answer.error;

      const inputText = request.messages
        .flatMap((m) => m.content)
        .map((c) => (c.type === "text" ? c.text : ""))
        .concat(request.system.map((b) => b.text))
        .join("");
      const base = {
        model: options.model ?? request.model,
        fallbackRan: false,
        retriedForMaxTokens: false,
        latencyMs: 0,
        requestId: `fake-${callIndex}`,
      };
      const usage = (rawText: string) => ({
        inputTokens: estimateTokens(inputText),
        outputTokens: estimateTokens(rawText),
      });

      if ("refusal" in answer) {
        return {
          ...base,
          data: null,
          rawText: "",
          stopReason: "refusal",
          refusal: {
            category: answer.refusal.category ?? null,
            explanation: answer.refusal.explanation ?? null,
          },
          usage: usage(""),
        };
      }
      if ("maxTokens" in answer) {
        return {
          ...base,
          data: null,
          rawText: "",
          stopReason: "max_tokens",
          validationError: "The output was cut off at the token limit.",
          usage: usage(""),
        };
      }
      const rawText = "rawText" in answer ? answer.rawText : JSON.stringify(answer.data);
      const result: StructuredResult<T> = {
        ...base,
        data: null,
        rawText,
        stopReason: "end_turn",
        usage: usage(rawText),
      };
      let json: unknown;
      try {
        json = JSON.parse(rawText);
      } catch (error) {
        result.validationError = `Output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
        return result;
      }
      const parsed = request.schema.safeParse(json);
      if (parsed.success) result.data = parsed.data;
      else {
        result.validationError = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
      }
      return result;
    },
  };
}
