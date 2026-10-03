import { createMemoryStorage } from "./memory";
import { createR2Storage, type R2Config } from "./r2";
import type { StorageProvider } from "./types";

export type StorageConfig = { provider: "memory" } | ({ provider: "r2" } & R2Config);

/** Builds the provider chosen by `STORAGE_PROVIDER` (the `storage` part of the loaded env). */
export function createStorage(config: StorageConfig): StorageProvider {
  if (config.provider === "memory") return createMemoryStorage();
  const { provider: _provider, ...r2 } = config;
  return createR2Storage(r2);
}
