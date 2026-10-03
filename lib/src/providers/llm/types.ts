import type { z } from "zod";

// LLM provider interface (plan 07 §7.3). Business code never imports a vendor SDK: stages go
// through runStage(), which calls an LLMProvider (Anthropic in production, a fake in tests).

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** One text block of the system prompt; stable blocks first, `cache` marks a cache breakpoint. */
export type LLMSystemBlock = { text: string; cache?: boolean };

export type LLMContent =
  | { type: "text"; text: string }
  | { type: "pdf"; base64: string; title?: string }
  | { type: "image"; base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };

export type StructuredRequest<T> = {
  model: string;
  system: readonly LLMSystemBlock[];
  /** Single turn; repairs are new requests (07 §7.8). */
  messages: readonly { role: "user"; content: readonly LLMContent[] }[];
  schema: z.ZodType<T>;
  /** Name used in logs; the API takes the schema itself. */
  schemaName: string;
  effort?: Effort;
  maxTokens: number;
  /** True for long outputs (knowledge extraction). */
  stream?: boolean;
  timeoutMs?: number;
  meta: { stage: string; promptId: string; promptVersion: number };
};

export type LLMUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type StopReason = "end_turn" | "max_tokens" | "refusal" | (string & {});

export type StructuredResult<T> = {
  /** Null when the output was refused, truncated or did not match the schema. */
  data: T | null;
  /** Text blocks of the answer, concatenated. */
  rawText: string;
  stopReason: StopReason;
  /** Why `data` is null for a non-refusal: the JSON or schema problem, for repair messages. */
  validationError?: string;
  /** Present when the model declined (`stopReason: "refusal"`). */
  refusal?: { category: string | null; explanation: string | null };
  /** Summed over a retry after `max_tokens`. */
  usage: LLMUsage;
  /** The model that actually answered (differs from the request after a refusal fallback). */
  model: string;
  /** True when a refusal fallback model produced the answer. */
  fallbackRan: boolean;
  /** True when the first attempt hit `max_tokens` and the answer comes from the retry. */
  retriedForMaxTokens: boolean;
  latencyMs: number;
  requestId?: string;
};

export type LLMProvider = {
  readonly id: "anthropic" | "fake";
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
};
