import { schema } from "@rc/db";
import type { AccountHealthSnapshot } from "@rc/db/json";
import { and, asc, desc, eq, inArray, isNull } from "@rc/db/orm";
import { ForbiddenError, InvalidStateError, NotFoundError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type PublishMode, type ServiceContext, withTransaction } from "../core";
import { type SocialAccount, type SocialAccountView, toAccountView } from "./accounts";

// What the Settings → Instagram screen and the app-shell banners show (plan 10 §10.1, M5-03), and
// disconnecting an account.

/** A token that expires within this many days is called expiring (plan 09 §9.2, 10 §10.1). */
export const EXPIRING_DAYS = 7;
const DAY_MS = 86_400_000;

export type AccountHealth = "NOT_CONNECTED" | "OK" | "EXPIRING" | "NEEDS_REAUTH" | "DISCONNECTED";

/** Where an account stands. An expired or invalid token is NEEDS_REAUTH whatever its status says. */
export function accountHealth(
  account: Pick<SocialAccount, "status" | "tokenStatus" | "tokenExpiresAt"> | null | undefined,
  now: Date,
): AccountHealth {
  if (!account) return "NOT_CONNECTED";
  if (account.status === "DISABLED" || account.status === "REVOKED") return "DISCONNECTED";
  const expires = account.tokenExpiresAt?.getTime();
  if (
    account.status === "NEEDS_REAUTH" ||
    account.tokenStatus === "INVALID" ||
    account.tokenStatus === "REVOKED" ||
    (expires !== undefined && expires <= now.getTime())
  ) {
    return "NEEDS_REAUTH";
  }
  if (
    account.tokenStatus === "EXPIRING" ||
    (expires !== undefined && expires - now.getTime() < EXPIRING_DAYS * DAY_MS)
  ) {
    return "EXPIRING";
  }
  return "OK";
}

export type InstagramMarketRow = {
  market: {
    id: string;
    code: string;
    displayName: string;
    flagEmoji: string | null;
    timezone: string;
  };
  account: SocialAccountView | null;
  health: AccountHealth;
  /** Whole days until the token expires (negative: expired); null when unknown. */
  daysLeft: number | null;
  lastPublish: { publishedAt: Date; permalink: string | null } | null;
  /** The newest unresolved finding of the account, or the last failed health check. */
  lastError: { code: string; message: string; occurredAt: Date | null } | null;
  quota: { used: number; total: number } | null;
};

export type InstagramOverview = {
  publishMode: PublishMode;
  /** The environment has a Meta app, so Connect can work. */
  configured: boolean;
  markets: InstagramMarketRow[];
};

/** One row per active market with its newest ACTIVE (else newest) Instagram account. */
export async function getInstagramOverview(ctx: ServiceContext): Promise<InstagramOverview> {
  const now = ctx.clock.now();
  const markets = await ctx.db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.isActive, true))
    .orderBy(asc(schema.markets.sortOrder));
  const accounts = await ctx.db
    .select()
    .from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.platform, "instagram"))
    .orderBy(desc(schema.socialAccounts.connectedAt));
  const published = await ctx.db
    .select({
      marketId: schema.publications.marketId,
      publishedAt: schema.publications.publishedAt,
      permalink: schema.publications.permalink,
    })
    .from(schema.publications)
    .where(and(eq(schema.publications.status, "PUBLISHED"), eq(schema.publications.dryRun, false)))
    .orderBy(desc(schema.publications.publishedAt));
  const events = await ctx.db
    .select()
    .from(schema.integrationEvents)
    .where(
      and(
        eq(schema.integrationEvents.integration, "instagram"),
        isNull(schema.integrationEvents.resolvedAt),
        inArray(schema.integrationEvents.severity, ["WARN", "ERROR"]),
      ),
    )
    .orderBy(desc(schema.integrationEvents.occurredAt));

  const rows = markets.map((market): InstagramMarketRow => {
    const mine = accounts.filter((a) => a.marketId === market.id);
    const account = mine.find((a) => a.status !== "DISABLED" && a.status !== "REVOKED") ?? mine[0];
    const health = accountHealth(account, now);
    const last = published.find((p) => p.marketId === market.id && p.publishedAt);
    const event = account && events.find((e) => e.socialAccountId === account.id);
    const snapshot: AccountHealthSnapshot | null = account?.lastHealth ?? null;
    return {
      market: {
        id: market.id,
        code: market.code,
        displayName: market.displayName,
        flagEmoji: market.flagEmoji,
        timezone: market.timezone,
      },
      account: account ? toAccountView(account) : null,
      health,
      daysLeft: account?.tokenExpiresAt
        ? Math.floor((account.tokenExpiresAt.getTime() - now.getTime()) / DAY_MS)
        : null,
      lastPublish: last?.publishedAt
        ? { publishedAt: last.publishedAt, permalink: last.permalink }
        : null,
      lastError: event
        ? { code: event.code, message: event.message, occurredAt: event.occurredAt }
        : snapshot && !snapshot.ok && snapshot.error
          ? {
              code: "HEALTH",
              message: snapshot.error,
              occurredAt: account?.lastHealthCheckAt ?? null,
            }
          : null,
      quota:
        snapshot?.quotaUsage !== undefined && snapshot.quotaTotal !== undefined
          ? { used: snapshot.quotaUsage, total: snapshot.quotaTotal }
          : null,
    };
  });
  return {
    publishMode: ctx.instagram.publishMode,
    configured: Boolean(ctx.instagram.app),
    markets: rows,
  };
}

export type InstagramBanner = {
  kind: "NEEDS_REAUTH" | "EXPIRING";
  marketCode: string;
  marketName: string;
  flagEmoji: string | null;
  daysLeft: number | null;
};

/** Accounts that need a person: re-auth first, then expiring (10 §10.1). */
export async function getInstagramBanners(ctx: ServiceContext): Promise<InstagramBanner[]> {
  const { markets } = await getInstagramOverview(ctx);
  return markets
    .filter((m) => m.health === "NEEDS_REAUTH" || m.health === "EXPIRING")
    .map((m) => ({
      kind: m.health as "NEEDS_REAUTH" | "EXPIRING",
      marketCode: m.market.code,
      marketName: m.market.displayName,
      flagEmoji: m.market.flagEmoji,
      daysLeft: m.daysLeft,
    }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "NEEDS_REAUTH" ? -1 : 1));
}

export const DisconnectAccountInput = z.object({ socialAccountId: z.uuid() });

/**
 * Disconnects an account (owner): the token is destroyed, the account becomes DISABLED and the
 * market is free to connect another. A post that is being published right now blocks it; posts that
 * are only scheduled stay and the calendar shows that the market has no account (M4-09).
 */
export async function disconnectInstagramAccount(
  ctx: ServiceContext,
  raw: z.input<typeof DisconnectAccountInput>,
): Promise<{ socialAccountId: string }> {
  if (ctx.actor.type !== "USER" || ctx.actor.role !== "owner") {
    throw new ForbiddenError("Only an owner can disconnect an Instagram account.");
  }
  const { socialAccountId } = DisconnectAccountInput.parse(raw);
  return withTransaction(ctx, async (tx) => {
    const [account] = await tx.db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, socialAccountId))
      .for("update");
    if (!account) throw new NotFoundError("Account not found.");
    if (account.status === "DISABLED" || account.status === "REVOKED") {
      throw new InvalidStateError("This account is already disconnected.");
    }
    const busy = await tx.db
      .select({ id: schema.publications.id })
      .from(schema.publications)
      .where(
        and(
          eq(schema.publications.socialAccountId, account.id),
          inArray(schema.publications.status, ["QUEUED", "IN_PROGRESS"]),
        ),
      );
    if (busy.length > 0) {
      throw new InvalidStateError(
        "A post is being published right now. Disconnect when it has finished.",
      );
    }
    await tx.db
      .update(schema.socialAccounts)
      .set({
        status: "DISABLED",
        tokenStatus: "REVOKED",
        // The token is destroyed; a value that is not a ciphertext can never be used.
        accessTokenEncrypted: "revoked",
        tokenExpiresAt: null,
      })
      .where(eq(schema.socialAccounts.id, account.id));
    await audit(tx, {
      action: "instagram.disconnected",
      entityType: "social_account",
      entityId: account.id,
      marketId: account.marketId,
      data: { username: account.username },
    });
    return { socialAccountId: account.id };
  });
}
