import { createFakeEmbeddingProvider } from "./fake";
import { createOpenAIEmbeddingProvider } from "./openai";
import type { EmbeddingProvider } from "./types";

export type EmbeddingsConfig = { provider: "fake" } | { provider: "live"; openaiApiKey: string };

/** The provider chosen by `AI_PROVIDER` (the `ai` part of the loaded env). */
export function createEmbeddingProvider(config: EmbeddingsConfig): EmbeddingProvider {
  return config.provider === "live"
    ? createOpenAIEmbeddingProvider({ apiKey: config.openaiApiKey })
    : createFakeEmbeddingProvider();
}
