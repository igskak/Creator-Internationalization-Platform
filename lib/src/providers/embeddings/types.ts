// Embedding provider interface (plan 07 §7.3). Vectors go into `vector(1536)` columns (D-09, D-11).

/** Dimensions of every stored vector. Changing it is a migration plus a re-embed of everything. */
export const EMBEDDING_DIMENSIONS = 1536;
/** The model behind the stored vectors; recorded per row in `embedding_model`. */
export const EMBEDDING_MODEL = "text-embedding-3-large";

export type EmbeddingProvider = {
  readonly id: "openai" | "fake";
  readonly model: string;
  readonly dimensions: number;
  /**
   * One vector per text, in order. `purpose` is accepted for providers that embed queries and
   * documents differently; OpenAI's models do not, so it changes nothing there.
   */
  embed(texts: readonly string[], options: { purpose: "document" | "query" }): Promise<number[][]>;
};

/** What is stored next to a vector: the model that made it and the hash of the embedded text. */
export type EmbeddedText = { vector: number[]; model: string; hash: string };
