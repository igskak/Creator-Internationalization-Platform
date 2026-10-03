export { embeddingHash, embedTexts } from "./embed-texts";
export { createEmbeddingProvider, type EmbeddingsConfig } from "./factory";
export { createFakeEmbeddingProvider, type FakeEmbeddingOptions } from "./fake";
export { createOpenAIEmbeddingProvider, type OpenAIEmbeddingOptions } from "./openai";
export {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type EmbeddedText,
  type EmbeddingProvider,
} from "./types";
