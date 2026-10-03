import { createAnthropicProvider } from "./anthropic";
import { createFakeLLMProvider } from "./fake";
import type { LLMProvider } from "./types";

export type LlmConfig = { provider: "fake" } | { provider: "live"; anthropicApiKey: string };

/**
 * The provider chosen by `AI_PROVIDER` (the `ai` part of the loaded env). `fake` has no fixtures:
 * every call fails until tests or E2E set up their own fake.
 */
export function createLlmProvider(config: LlmConfig): LLMProvider {
  return config.provider === "live"
    ? createAnthropicProvider({ apiKey: config.anthropicApiKey })
    : createFakeLLMProvider();
}
