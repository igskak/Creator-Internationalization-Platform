import type { AnyPrompt } from "./define";

export type PromptRegistry = {
  /** Throws if `id@version` is not registered. */
  get(id: string, version: number): AnyPrompt;
  has(id: string, version: number): boolean;
  /** Registered versions of a prompt, ascending. */
  versions(id: string): number[];
  /** The highest registered version. The active one is chosen in modules/src/ai/config.ts. */
  latest(id: string): AnyPrompt;
  list(): AnyPrompt[];
};

/** Registry by `id@version`; registering the same key twice is an error. */
export function createRegistry(prompts: readonly AnyPrompt[]): PromptRegistry {
  const byKey = new Map<string, AnyPrompt>();
  for (const prompt of prompts) {
    if (byKey.has(prompt.key)) throw new Error(`Duplicate prompt ${prompt.key}.`);
    byKey.set(prompt.key, prompt);
  }
  const versions = (id: string) =>
    [...byKey.values()]
      .filter((p) => p.id === id)
      .map((p) => p.version)
      .sort((a, b) => a - b);
  const get = (id: string, version: number): AnyPrompt => {
    const prompt = byKey.get(`${id}@${version}`);
    if (!prompt) throw new Error(`Unknown prompt ${id}@${version}.`);
    return prompt;
  };
  return {
    get,
    has: (id, version) => byKey.has(`${id}@${version}`),
    versions,
    latest: (id) => {
      const latest = versions(id).at(-1);
      if (latest === undefined) throw new Error(`Unknown prompt ${id}.`);
      return get(id, latest);
    },
    list: () => [...byKey.values()],
  };
}
