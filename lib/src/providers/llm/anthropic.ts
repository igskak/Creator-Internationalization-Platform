import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PermanentError, TransientError } from "../../errors";
import type {
  LLMContent,
  LLMProvider,
  LLMUsage,
  StructuredRequest,
  StructuredResult,
} from "./types";

// Anthropic adapter (plan 07 §7.4, V-18). Rules: adaptive thinking, `output_config.effort` and
// `output_config.format`, no temperature (rejected by current models), PDFs as `document` blocks
// (no citations: they cannot be combined with structured outputs), refusal fallback, one retry
// with a larger limit after `max_tokens`, SDK retries for 429/5xx/network.

export type AnthropicProviderOptions = {
  apiKey: string;
  baseURL?: string;
  /** SDK retries for 429, 5xx and network errors. Default 3. */
  maxRetries?: number;
  /** Per-request timeout when the request has none. Default 10 minutes. */
  timeoutMs?: number;
  /**
   * Server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`).
   * On by default; `false` to send plain requests.
   */
  fallback?: "default" | false;
  /** A prepared client, for tests. */
  client?: Anthropic;
};

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_OUTPUT_TOKENS = 128_000;

function toBlocks(content: readonly LLMContent[]): Anthropic.Beta.Messages.BetaContentBlockParam[] {
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "pdf") {
      return {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: part.base64 },
        ...(part.title ? { title: part.title } : {}),
      };
    }
    return {
      type: "image",
      source: { type: "base64", media_type: part.mediaType, data: part.base64 },
    };
  });
}

/** Rate limit, overload, 5xx, timeout and network errors are retryable; client errors are not. */
export function mapAnthropicError(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError) return error;
  if (error instanceof Anthropic.APIConnectionError) {
    return new TransientError(`Anthropic connection error: ${error.message}`, { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    const details = { status: error.status, requestId: error.requestID ?? undefined };
    if (error.status === 429) {
      const retryAfter = Number(error.headers?.get("retry-after"));
      return new TransientError(`Anthropic rate limit: ${error.message}`, {
        rateLimited: true,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1000 }
          : {}),
        details,
        cause: error,
      });
    }
    if (
      error.status === undefined ||
      error.status >= 500 ||
      error.status === 408 ||
      error.status === 409
    ) {
      return new TransientError(`Anthropic error ${error.status ?? ""}: ${error.message}`, {
        details,
        cause: error,
      });
    }
    return new PermanentError(
      `Anthropic rejected the request (${error.status}): ${error.message}`,
      {
        details,
        cause: error,
      },
    );
  }
  return error;
}

function addUsage(a: LLMUsage | undefined, b: LLMUsage): LLMUsage {
  if (!a) return b;
  const sum = (x?: number, y?: number) =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  const cacheRead = sum(a.cacheReadTokens, b.cacheReadTokens);
  const cacheWrite = sum(a.cacheWriteTokens, b.cacheWriteTokens);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite }),
  };
}

export function createAnthropicProvider(options: AnthropicProviderOptions): LLMProvider {
  const client =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      maxRetries: options.maxRetries ?? 3,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
  const fallback = options.fallback ?? "default";
  const defaultTimeout = options.timeoutMs ?? 10 * 60 * 1000;

  async function attempt<T>(
    request: StructuredRequest<T>,
    maxTokens: number,
  ): Promise<{ message: Anthropic.Beta.Messages.BetaMessage; usage: LLMUsage }> {
    const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
      model: request.model,
      max_tokens: maxTokens,
      system: request.system.map((block) => ({
        type: "text" as const,
        text: block.text,
        ...(block.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
      })),
      messages: request.messages.map((m) => ({ role: m.role, content: toBlocks(m.content) })),
      thinking: { type: "adaptive" },
      output_config: {
        format: zodOutputFormat(request.schema),
        ...(request.effort ? { effort: request.effort } : {}),
      },
      ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: fallback } : {}),
    };
    const requestOptions = { timeout: request.timeoutMs ?? defaultTimeout };
    try {
      const message = request.stream
        ? await client.beta.messages.stream(params, requestOptions).finalMessage()
        : await client.beta.messages.create(params, requestOptions);
      const u = message.usage;
      return {
        message,
        usage: {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          ...(u.cache_read_input_tokens == null
            ? {}
            : { cacheReadTokens: u.cache_read_input_tokens }),
          ...(u.cache_creation_input_tokens == null
            ? {}
            : { cacheWriteTokens: u.cache_creation_input_tokens }),
        },
      };
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }

  return {
    id: "anthropic",
    async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const started = Date.now();
      let maxTokens = request.maxTokens;
      let first = await attempt(request, maxTokens);
      let retried = false;
      let usage = first.usage;
      // A truncated answer gets one retry with a larger limit; a second truncation is the caller's
      // INVALID_OUTPUT.
      if (first.message.stop_reason === "max_tokens" && maxTokens < MAX_OUTPUT_TOKENS) {
        maxTokens = Math.min(maxTokens * 2, MAX_OUTPUT_TOKENS);
        const second = await attempt(request, maxTokens);
        usage = addUsage(usage, second.usage);
        first = second;
        retried = true;
      }
      const { message } = first;
      const rawText = message.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const fallbackRan =
        message.content.some((b) => (b as { type: string }).type === "fallback") ||
        ((message.usage as { iterations?: { type: string }[] }).iterations ?? []).some(
          (entry) => entry.type === "fallback_message",
        );
      const stopReason = message.stop_reason ?? "end_turn";
      // The SDK attaches the request id to the parsed response object at runtime.
      const requestId = (message as { _request_id?: string | null })._request_id;

      const result: StructuredResult<T> = {
        data: null,
        rawText,
        stopReason,
        usage,
        model: message.model,
        fallbackRan,
        retriedForMaxTokens: retried,
        latencyMs: Date.now() - started,
        ...(requestId ? { requestId } : {}),
      };
      if (stopReason === "refusal") {
        const details = message.stop_details as {
          category?: string | null;
          explanation?: string | null;
        } | null;
        result.refusal = {
          category: details?.category ?? null,
          explanation: details?.explanation ?? null,
        };
        return result;
      }
      if (stopReason === "max_tokens") {
        result.validationError = "The output was cut off at the token limit.";
        return result;
      }
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
