import { createLogger, type Logger } from "@rc/lib/logging";
import type { InstagramRuntime, PublishMode } from "../core";
import { createMockGraphApi, type MockGraphApi, type MockGraphOptions } from "./mock/graph-mock";

// Fixtures for the Instagram tests (M5). Synthetic keys and secrets only.

export const TEST_APP_SECRET = "test-app-secret-0123456789";
export const TEST_STATE_SECRET = "s".repeat(32);
export const TEST_KEY_RING = {
  keys: new Map([["v1", new Uint8Array(32).fill(7)]]) as ReadonlyMap<string, Uint8Array>,
  activeKeyId: "v1",
};

/** The runtime of a context that talks to the mock Graph API. */
export function mockRuntime(
  mock: MockGraphApi,
  over: Partial<{ publishMode: PublishMode; allowlist: string[]; baseUrl: string }> = {},
): InstagramRuntime {
  return {
    publishMode: over.publishMode ?? "live",
    app: {
      appId: "1234567890",
      appSecret: TEST_APP_SECRET,
      redirectUri: "https://app.example.test/api/instagram/oauth/callback",
      graphApiVersion: "v25.0",
      graphBaseUrl: over.baseUrl ?? "https://graph.instagram.com",
      accountAllowlist: over.allowlist ?? [],
    },
    keyRing: TEST_KEY_RING,
    stateSecret: TEST_STATE_SECRET,
    fetch: mock.fetch,
  };
}

export function newMock(options: MockGraphOptions = {}): MockGraphApi {
  return createMockGraphApi({ appSecret: TEST_APP_SECRET, ...options });
}

/** A logger that keeps every line it is given, as text. */
export function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({
    service: "jobs",
    env: "test",
    level: "trace",
    destination: { write: (line: string) => void lines.push(line) },
  });
  return { logger, lines };
}
