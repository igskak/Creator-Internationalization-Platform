import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import { createLogger, type Logger } from "@rc/lib/logging";
import {
  createServiceContext,
  type InstagramRuntime,
  manualClock,
  type PublishMode,
  type ServiceContext,
} from "../core";
import { encryptAccessToken } from "./accounts";
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

/** Inserts an ACTIVE account for a market with a real (mock-issued) encrypted token. */
export async function connectTestAccount(
  ctx: ServiceContext,
  mock: MockGraphApi,
  input: {
    marketId: string;
    accountId: string;
    username?: string;
    /** When the mock issued the token (matters for its 24-hour refresh rule). */
    tokenIssuedAt?: Date;
    over?: Partial<typeof schema.socialAccounts.$inferInsert>;
  },
) {
  if (!mock.hasAccount(input.accountId)) {
    mock.addAccount({ id: input.accountId, username: input.username ?? `acct_${input.accountId}` });
  }
  const id = randomUUID();
  const token = mock.issueToken(input.accountId, input.tokenIssuedAt);
  const [row] = await ctx.db
    .insert(schema.socialAccounts)
    .values({
      id,
      marketId: input.marketId,
      username: input.username ?? `acct_${input.accountId}`,
      instagramAccountId: input.accountId,
      accountType: "BUSINESS",
      accessTokenEncrypted: encryptAccessToken(ctx, id, token),
      tokenExpiresAt: new Date(ctx.clock.now().getTime() + 50 * 86_400_000),
      tokenLastRefreshedAt: ctx.clock.now(),
      scopes: ["instagram_business_basic", "instagram_business_content_publish"],
      ...input.over,
    })
    .returning();
  if (!row) throw new Error("no account row");
  return { account: row, token };
}

/**
 * A context for the instagram module's own tests (the module may not import another domain's
 * fixtures): an owner of the seeded database, a manual clock at 2026-10-10 12:00 UTC, the mock.
 * `seedDatabase` must have run.
 */
export async function instagramFixture(db: ServiceContext["db"], mock: MockGraphApi) {
  const clock = manualClock("2026-10-10T12:00:00Z");
  const [owner] = await db.select().from(schema.appUsers);
  const userId = owner?.id ?? "";
  const as = (role: "owner" | "editor" | "chef") =>
    createServiceContext({
      db,
      logger: capturingLogger().logger,
      clock,
      instagram: mockRuntime(mock),
      actor: { type: "USER", userId, role },
    });
  const marketIds = Object.fromEntries(
    (await db.select().from(schema.markets)).map((m) => [m.code, m.id]),
  ) as Record<string, string>;
  return { ctx: as("owner"), as, userId, clock, marketIds };
}
