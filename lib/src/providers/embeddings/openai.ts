import { PermanentError, TransientError, ValidationError } from "../../errors";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, type EmbeddingProvider } from "./types";

// OpenAI embeddings adapter (plan 01 D-09, V-19 verified 2026-10-03). `text-embedding-3-large` with
// `dimensions: 1536`; limits of POST /v1/embeddings: 8,192 tokens per input, 2,048 inputs and
// 300,000 tokens per request, no empty strings. The API applies `dimensions` itself, so the
// vectors are used as returned (pgvector's cosine distance does not depend on their length).

export type OpenAIEmbeddingOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
  /** Retries after the first attempt for 429, 5xx, timeouts and network errors. Default 3. */
  maxRetries?: number;
  /** Per-request timeout. Default 60 s. */
  timeoutMs?: number;
  /** Called after each successful request with the billed input tokens (cost tracking). */
  onUsage?: (usage: { model: string; inputTokens: number }) => void;
  /** Injected in tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const MAX_INPUTS_PER_REQUEST = 2048;
/** Tokens are estimated at 2 characters each (Cyrillic is the worst case) to stay under 300,000. */
const REQUEST_TOKEN_BUDGET = 250_000;
const CHARS_PER_TOKEN_ESTIMATE = 2;
/** Far beyond 8,192 tokens in any script; the API still has the final say. */
const MAX_CHARS_PER_TEXT = 32_000;

export function createOpenAIEmbeddingProvider(options: OpenAIEmbeddingOptions): EmbeddingProvider {
  const model = options.model ?? EMBEDDING_MODEL;
  const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /** Retry-After header in seconds, or exponential backoff with jitter. */
  const delayFor = (attempt: number, retryAfter: string | null) => {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60_000);
    return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
  };

  async function request(input: readonly string[]): Promise<number[][]> {
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= maxRetries;
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({ model, input, dimensions, encoding_format: "float" }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (last) {
          throw new TransientError(
            `OpenAI embeddings request failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        await sleep(delayFor(attempt, null));
        continue;
      }

      if (response.ok) {
        const body = (await response.json()) as {
          data?: { index: number; embedding: number[] }[];
          usage?: { prompt_tokens?: number };
        };
        const items = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
        if (
          items.length !== input.length ||
          items.some((item) => item.embedding.length !== dimensions)
        ) {
          throw new PermanentError("OpenAI returned embeddings of an unexpected count or size.", {
            details: {
              expectedCount: input.length,
              count: items.length,
              expectedDimensions: dimensions,
              dimensions: items[0]?.embedding.length,
            },
          });
        }
        options.onUsage?.({ model, inputTokens: body.usage?.prompt_tokens ?? 0 });
        return items.map((item) => item.embedding);
      }

      const detail = await response
        .json()
        .then((body) => (body as { error?: { message?: string } }).error?.message ?? "")
        .catch(() => "");
      const details = { status: response.status };
      if (response.status === 429 || response.status >= 500 || response.status === 408) {
        if (last) {
          const retryAfter = Number(response.headers.get("retry-after"));
          throw new TransientError(`OpenAI embeddings error ${response.status}: ${detail}`, {
            rateLimited: response.status === 429,
            ...(Number.isFinite(retryAfter) && retryAfter > 0
              ? { retryAfterMs: retryAfter * 1000 }
              : {}),
            details,
          });
        }
        await sleep(delayFor(attempt, response.headers.get("retry-after")));
        continue;
      }
      throw new PermanentError(
        `OpenAI rejected the embeddings request (${response.status}): ${detail}`,
        {
          details,
        },
      );
    }
  }

  return {
    id: "openai",
    model,
    dimensions,
    async embed(texts) {
      texts.forEach((text, index) => {
        if (text.trim() === "") {
          throw new ValidationError("Cannot embed an empty text.", { details: { index } });
        }
        if (text.length > MAX_CHARS_PER_TEXT) {
          throw new ValidationError(`Text is too long to embed (${text.length} characters).`, {
            details: { index },
          });
        }
      });

      // Split into requests of at most 2,048 inputs and about 250,000 estimated tokens.
      const batches: string[][] = [];
      let current: string[] = [];
      let tokens = 0;
      for (const text of texts) {
        const estimate = Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
        if (
          current.length > 0 &&
          (current.length >= MAX_INPUTS_PER_REQUEST || tokens + estimate > REQUEST_TOKEN_BUDGET)
        ) {
          batches.push(current);
          current = [];
          tokens = 0;
        }
        current.push(text);
        tokens += estimate;
      }
      if (current.length > 0) batches.push(current);

      const vectors: number[][] = [];
      for (const batch of batches) vectors.push(...(await request(batch)));
      return vectors;
    },
  };
}
