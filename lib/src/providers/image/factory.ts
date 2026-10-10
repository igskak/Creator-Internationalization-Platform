import { createFakeImageProvider } from "./fake";
import { createOpenAIImageProvider } from "./openai";
import type { ImageProvider } from "./types";

export type ImagesConfig = { provider: "fake" } | { provider: "live"; openaiApiKey: string };

/** The provider chosen by `AI_PROVIDER` (the `ai` part of the loaded env). */
export function createImageProvider(config: ImagesConfig): ImageProvider {
  return config.provider === "live"
    ? createOpenAIImageProvider({ apiKey: config.openaiApiKey })
    : createFakeImageProvider();
}
