import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import { and, eq, isNull } from "@rc/db/orm";
import { ForbiddenError, NotFoundError, PermanentError } from "@rc/lib/errors";
import { createNonce, signToken, verifyToken } from "@rc/lib/security";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../core";
import {
  encryptAccessToken,
  INSTAGRAM_SCOPES,
  LONG_LIVED_TOKEN_SECONDS,
  type SocialAccount,
} from "./accounts";
import { InstagramCallError } from "./errors";
import {
  authorizeUrl,
  createGraphClient,
  oauthBaseUrl,
  oauthCall,
  requireInstagramApp,
} from "./http";

// Connecting an Instagram professional account to a market (plan 09 §9.2, M5-02). The browser
// part (cookie, redirects) is in apps/web; everything that decides is here.

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
/** Name of the httpOnly cookie that holds the signed state while the owner is on Instagram. */
export const OAUTH_STATE_COOKIE = "rc-ig-oauth";

type StateData = { marketId: string; userId: string; nonce: string };

const needOwner = (ctx: ServiceContext): string => {
  if (ctx.actor.type !== "USER" || ctx.actor.role !== "owner") {
    throw new ForbiddenError("Only an owner can connect an Instagram account.");
  }
  return ctx.actor.userId;
};

function stateSecret(ctx: ServiceContext): string {
  if (!ctx.instagram.stateSecret) throw new PermanentError("OAUTH_STATE_SECRET is not configured.");
  return ctx.instagram.stateSecret;
}

/**
 * Step 1 (owner only): the Instagram authorize URL and the signed state. The caller sets the state
 * as an httpOnly SameSite=Lax cookie (`OAUTH_STATE_COOKIE`, max age `OAUTH_STATE_TTL_MS`) and
 * redirects. The state binds the market, the owner and a nonce, and expires in 10 minutes.
 */
export async function startInstagramOAuth(
  ctx: ServiceContext,
  input: { marketId: string },
): Promise<{ authorizeUrl: string; state: string }> {
  const userId = needOwner(ctx);
  const app = requireInstagramApp(ctx.instagram);
  const [market] = await ctx.db
    .select({ id: schema.markets.id, active: schema.markets.isActive })
    .from(schema.markets)
    .where(eq(schema.markets.id, input.marketId));
  if (!market) throw new NotFoundError("Market not found.");
  if (!market.active) throw new ForbiddenError("This market is not active.");

  const data: StateData = { marketId: market.id, userId, nonce: createNonce() };
  const state = signToken(data, {
    secret: stateSecret(ctx),
    expiresAt: new Date(ctx.clock.now().getTime() + OAUTH_STATE_TTL_MS),
  });
  const url = new URL(authorizeUrl(app));
  url.searchParams.set("client_id", app.appId);
  url.searchParams.set("redirect_uri", app.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  url.searchParams.set("state", state);
  await audit(ctx, {
    action: "instagram.connect_started",
    entityType: "market",
    entityId: market.id,
    marketId: market.id,
  });
  return { authorizeUrl: url.toString(), state };
}

export type OAuthFailureReason =
  | "invalid_state"
  | "expired_state"
  | "state_mismatch"
  | "denied"
  | "exchange_failed"
  | "not_professional"
  | "bound_to_other_market"
  | "market_has_other_account"
  | "market_not_found";

export type OAuthResult =
  | { ok: true; socialAccountId: string; marketId: string; username: string; reconnected: boolean }
  | { ok: false; reason: OAuthFailureReason; message: string };

const FAILURE_TEXT: Record<OAuthFailureReason, string> = {
  invalid_state: "The connection request was not valid. Start again from Settings → Instagram.",
  expired_state: "The connection request expired. Start again from Settings → Instagram.",
  state_mismatch: "The connection request did not match this browser. Start again.",
  denied: "Instagram access was not granted.",
  exchange_failed: "Instagram did not accept the connection. Try again in a few minutes.",
  not_professional:
    "This Instagram account is not a professional account. Switch it to Business or Creator in the Instagram app, then connect again.",
  bound_to_other_market: "This Instagram account is already connected to another market.",
  market_has_other_account:
    "This market already has a connected Instagram account. Disconnect it first.",
  market_not_found: "The market of this request no longer exists.",
};

const failed = (reason: OAuthFailureReason): OAuthResult => ({
  ok: false,
  reason,
  message: FAILURE_TEXT[reason],
});

const ShortToken = z.union([
  z.object({
    data: z
      .array(
        z.object({
          access_token: z.string().min(1),
          user_id: z.union([z.string(), z.number()]),
          permissions: z.union([z.string(), z.array(z.string())]).optional(),
        }),
      )
      .min(1),
  }),
  // The older flat shape.
  z.object({
    access_token: z.string().min(1),
    user_id: z.union([z.string(), z.number()]),
    permissions: z.union([z.string(), z.array(z.string())]).optional(),
  }),
]);

const LongToken = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

const Me = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  user_id: z.union([z.string(), z.number()]),
  username: z.string().min(1),
  account_type: z.string().optional(),
});

const PROFESSIONAL = new Set(["BUSINESS", "MEDIA_CREATOR"]);

/**
 * Steps 2–7: checks the state against the cookie, trades the code for a long-lived token, reads
 * the profile, refuses accounts that are not professional or are bound elsewhere, and stores the
 * encrypted token (AAD = row id). Expected failures come back as `{ ok: false }` (audited); only
 * programming and configuration errors throw. The token is never returned, logged or audited.
 */
export async function completeInstagramOAuth(
  ctx: ServiceContext,
  input: {
    code: string | null;
    state: string | null;
    cookieState: string | null;
    denied?: boolean;
  },
): Promise<OAuthResult> {
  const userId = needOwner(ctx);
  const app = requireInstagramApp(ctx.instagram);

  const deny = async (
    reason: OAuthFailureReason,
    extra: Record<string, unknown> = {},
    marketId?: string,
    on: ServiceContext = ctx,
  ) => {
    await audit(on, {
      action: "instagram.connect_failed",
      entityType: "market",
      ...(marketId ? { entityId: marketId, marketId } : {}),
      data: { reason, ...extra },
    });
    return failed(reason);
  };

  if (!input.state || !input.cookieState) return deny("invalid_state");
  const verified = verifyToken<StateData>(input.state, {
    secret: stateSecret(ctx),
    now: ctx.clock.now(),
  });
  if (!verified.ok) {
    return deny(verified.reason === "expired" ? "expired_state" : "invalid_state");
  }
  if (input.state !== input.cookieState || verified.data.userId !== userId) {
    return deny("state_mismatch");
  }
  const { marketId } = verified.data;
  if (input.denied || !input.code) return deny("denied", {}, marketId);

  const [market] = await ctx.db
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.id, marketId));
  if (!market) return deny("market_not_found", {}, marketId);

  // Instagram appends "#_" to the code in the redirect.
  const code = input.code.replace(/#_$/, "");
  const now = ctx.clock.now();
  let longToken: string;
  let expiresInSeconds: number;
  let scopes: string[];
  let shortUserId: string;
  try {
    const shortResponse = ShortToken.parse(
      await oauthCall(ctx.instagram, ctx.logger, {
        method: "POST",
        url: `${oauthBaseUrl(app)}/oauth/access_token`,
        params: {
          client_id: app.appId,
          client_secret: app.appSecret,
          grant_type: "authorization_code",
          redirect_uri: app.redirectUri,
          code,
        },
      }),
    );
    const short = "data" in shortResponse ? shortResponse.data[0] : shortResponse;
    if (!short) throw new PermanentError("The code exchange returned no token.");
    shortUserId = String(short.user_id);
    scopes = (
      Array.isArray(short.permissions)
        ? short.permissions
        : (short.permissions?.split(",") ?? [...INSTAGRAM_SCOPES])
    )
      .map((s) => s.trim())
      .filter(Boolean);

    const long = LongToken.parse(
      await oauthCall(ctx.instagram, ctx.logger, {
        method: "GET",
        url: `${app.graphBaseUrl.replace(/\/+$/, "")}/access_token`,
        params: {
          grant_type: "ig_exchange_token",
          client_secret: app.appSecret,
          access_token: short.access_token,
        },
      }),
    );
    longToken = long.access_token;
    expiresInSeconds = long.expires_in ?? LONG_LIVED_TOKEN_SECONDS;
  } catch (error) {
    if (error instanceof InstagramCallError || error instanceof z.ZodError) {
      return deny(
        "exchange_failed",
        error instanceof InstagramCallError
          ? { classification: error.error.classification, code: error.error.code }
          : { problem: "unexpected answer" },
        marketId,
      );
    }
    throw error;
  }

  // Profile: the account must be professional.
  let me: z.infer<typeof Me>;
  try {
    const client = createGraphClient(ctx.instagram, { accessToken: longToken, logger: ctx.logger });
    me = Me.parse(await client.get("/me", { fields: "user_id,username,account_type" }));
  } catch (error) {
    if (error instanceof InstagramCallError || error instanceof z.ZodError) {
      return deny("exchange_failed", { step: "me" }, marketId);
    }
    throw error;
  }
  const accountType = me.account_type?.toUpperCase();
  if (!accountType || !PROFESSIONAL.has(accountType)) {
    return deny("not_professional", { accountType: accountType ?? null }, marketId);
  }
  const instagramAccountId = String(me.user_id);
  const appScopedUserId = String(me.id ?? shortUserId);

  return withTransaction(ctx, async (tx): Promise<OAuthResult> => {
    const rows = await tx.db
      .select()
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.platform, "instagram"),
          eq(schema.socialAccounts.instagramAccountId, instagramAccountId),
        ),
      );
    const existing: SocialAccount | undefined = rows[0];
    if (existing && existing.marketId !== marketId && existing.status !== "REVOKED") {
      if (existing.status === "ACTIVE" || existing.status === "NEEDS_REAUTH") {
        return deny("bound_to_other_market", { otherMarketId: existing.marketId }, marketId, tx);
      }
    }
    const [other] = await tx.db
      .select({ id: schema.socialAccounts.id })
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.marketId, marketId),
          eq(schema.socialAccounts.platform, "instagram"),
          eq(schema.socialAccounts.status, "ACTIVE"),
        ),
      );
    if (other && other.id !== existing?.id) {
      return deny("market_has_other_account", {}, marketId, tx);
    }

    const id = existing?.id ?? randomUUID();
    const values = {
      marketId,
      username: me.username,
      instagramAccountId,
      appScopedUserId,
      accountType,
      accessTokenEncrypted: encryptAccessToken(tx, id, longToken),
      tokenExpiresAt: new Date(now.getTime() + expiresInSeconds * 1000),
      tokenLastRefreshedAt: now,
      tokenStatus: "VALID" as const,
      scopes,
      status: "ACTIVE" as const,
      connectedAt: now,
      connectedBy: userId,
      lastHealth: null,
    };
    if (existing) {
      await tx.db
        .update(schema.socialAccounts)
        .set(values)
        .where(eq(schema.socialAccounts.id, existing.id));
    } else {
      await tx.db.insert(schema.socialAccounts).values({ id, ...values });
    }
    // A fresh connection settles the open "reconnect" findings of this account.
    await tx.db
      .update(schema.integrationEvents)
      .set({ resolvedAt: now })
      .where(
        and(
          eq(schema.integrationEvents.socialAccountId, id),
          eq(schema.integrationEvents.integration, "instagram"),
          isNull(schema.integrationEvents.resolvedAt),
        ),
      );
    await audit(tx, {
      action: "instagram.connected",
      entityType: "social_account",
      entityId: id,
      marketId,
      data: {
        username: me.username,
        instagramAccountId,
        accountType,
        scopes,
        reconnected: Boolean(existing),
      },
    });
    return {
      ok: true,
      socialAccountId: id,
      marketId,
      username: me.username,
      reconnected: Boolean(existing),
    };
  });
}
