import { schema } from "@rc/db";
import { and, eq, inArray } from "@rc/db/orm";
import { TransientError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext } from "../core";
import {
  decryptAccessToken,
  encryptAccessToken,
  LONG_LIVED_TOKEN_SECONDS,
  type SocialAccount,
} from "./accounts";
import { InstagramCallError } from "./errors";
import { recordIntegrationEvent, resolveIntegrationEvents } from "./events";
import { oauthCall, requireInstagramApp } from "./http";
import { EXPIRING_DAYS } from "./status";

// Keeping the long-lived tokens alive (J13, plan 06 §6.3, 09 §9.2, M5-04).

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A token is refreshed once it is at least a day old (V-03) and ... */
export const MIN_REFRESH_AGE_MS = DAY_MS;
/** ... expires within 20 days, or was last refreshed 7 or more days ago. */
export const REFRESH_WHEN_EXPIRING_DAYS = 20;
export const REFRESH_AT_AGE_DAYS = 7;

export type RefreshDecision = "REFRESH" | "TOO_RECENT" | "NOT_DUE";

/** Whether an account's token should be refreshed now (09 §9.2). */
export function refreshDecision(
  account: Pick<SocialAccount, "tokenExpiresAt" | "tokenLastRefreshedAt" | "connectedAt">,
  now: Date,
): RefreshDecision {
  const last = account.tokenLastRefreshedAt ?? account.connectedAt;
  const age = now.getTime() - last.getTime();
  if (age < MIN_REFRESH_AGE_MS) return "TOO_RECENT";
  const expires = account.tokenExpiresAt?.getTime();
  const expiringSoon =
    expires !== undefined && expires - now.getTime() < REFRESH_WHEN_EXPIRING_DAYS * DAY_MS;
  return expiringSoon || age >= REFRESH_AT_AGE_DAYS * DAY_MS ? "REFRESH" : "NOT_DUE";
}

export const RefreshTokensInput = z.object({ socialAccountId: z.uuid().optional() });

export type TokenRefreshOutcome =
  | "REFRESHED"
  | "SKIPPED_TOO_RECENT"
  | "SKIPPED_NOT_DUE"
  | "NEEDS_REAUTH"
  | "EXPIRING"
  | "FAILED";

export type TokenRefreshResult = {
  socialAccountId: string;
  marketId: string;
  outcome: TokenRefreshOutcome;
  /** Classification of the failure, if any. */
  problem?: string;
};

const RefreshAnswer = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

/**
 * J13: refreshes the tokens of the ACTIVE accounts that are due. Each account is handled on its
 * own, so one failure does not stop the others. A token Instagram no longer accepts (code 190) or
 * that has already expired makes the account NEEDS_REAUTH with an ERROR finding; a token that
 * could not be refreshed but is still valid for under 7 days becomes EXPIRING with a WARN. If any
 * account failed for a transient reason the job throws at the end, so the runner retries, and the
 * retry only touches accounts that are still due (the 24-hour rule makes it idempotent).
 */
export async function refreshInstagramTokens(
  ctx: ServiceContext,
  raw: z.input<typeof RefreshTokensInput> = {},
): Promise<{ results: TokenRefreshResult[] }> {
  const input = RefreshTokensInput.parse(raw);
  const app = requireInstagramApp(ctx.instagram);
  const accounts = await ctx.db
    .select()
    .from(schema.socialAccounts)
    .where(
      and(
        eq(schema.socialAccounts.platform, "instagram"),
        inArray(schema.socialAccounts.status, ["ACTIVE"]),
        ...(input.socialAccountId ? [eq(schema.socialAccounts.id, input.socialAccountId)] : []),
      ),
    );
  const results: TokenRefreshResult[] = [];
  let transient: unknown;

  for (const account of accounts) {
    const now = ctx.clock.now();
    const base = { socialAccountId: account.id, marketId: account.marketId };
    const decision = refreshDecision(account, now);
    if (decision !== "REFRESH") {
      // An expired token that nobody can refresh any more is still a problem to flag.
      if (account.tokenExpiresAt && account.tokenExpiresAt <= now) {
        results.push({ ...base, outcome: await markReauth(ctx, account, "TOKEN_EXPIRED") });
      } else {
        results.push({
          ...base,
          outcome: decision === "TOO_RECENT" ? "SKIPPED_TOO_RECENT" : "SKIPPED_NOT_DUE",
        });
      }
      continue;
    }
    try {
      const token = decryptAccessToken(ctx, account);
      const answer = RefreshAnswer.parse(
        await oauthCall(ctx.instagram, ctx.logger, {
          method: "GET",
          url: `${app.graphBaseUrl.replace(/\/+$/, "")}/refresh_access_token`,
          params: { grant_type: "ig_refresh_token", access_token: token },
        }),
      );
      const expiresAt = new Date(
        now.getTime() + (answer.expires_in ?? LONG_LIVED_TOKEN_SECONDS) * 1000,
      );
      await ctx.db
        .update(schema.socialAccounts)
        .set({
          accessTokenEncrypted: encryptAccessToken(ctx, account.id, answer.access_token),
          tokenExpiresAt: expiresAt,
          tokenLastRefreshedAt: now,
          tokenStatus: "VALID",
        })
        .where(eq(schema.socialAccounts.id, account.id));
      await resolveIntegrationEvents(ctx, account.id, ["TOKEN_REFRESH_FAILED", "TOKEN_EXPIRING"]);
      await audit(ctx, {
        action: "instagram.token_refreshed",
        entityType: "social_account",
        entityId: account.id,
        marketId: account.marketId,
        data: { expiresAt: expiresAt.toISOString() },
      });
      results.push({ ...base, outcome: "REFRESHED" });
    } catch (error) {
      if (error instanceof InstagramCallError && error.error.classification === "AUTH") {
        results.push({
          ...base,
          outcome: await markReauth(ctx, account, "TOKEN_INVALID", error),
          problem: "AUTH",
        });
        continue;
      }
      const problem =
        error instanceof InstagramCallError ? error.error.classification : "UNEXPECTED";
      ctx.logger.warn({ socialAccountId: account.id, problem }, "token refresh failed");
      const stillValid = account.tokenExpiresAt && account.tokenExpiresAt > now;
      const soon =
        stillValid &&
        account.tokenExpiresAt &&
        account.tokenExpiresAt.getTime() - now.getTime() < EXPIRING_DAYS * DAY_MS;
      if (soon) {
        await ctx.db
          .update(schema.socialAccounts)
          .set({ tokenStatus: "EXPIRING" })
          .where(eq(schema.socialAccounts.id, account.id));
      }
      await recordIntegrationEvent(ctx, {
        socialAccountId: account.id,
        severity: soon ? "ERROR" : "WARN",
        code: "TOKEN_REFRESH_FAILED",
        message: `The Instagram token of @${account.username} could not be refreshed.`,
        details: { problem },
      });
      results.push({ ...base, outcome: soon ? "EXPIRING" : "FAILED", problem });
      transient ??= error instanceof InstagramCallError ? error.toAppError() : error;
    }
  }
  if (transient) {
    // Everything that could be done is done; let the runner retry the accounts that failed.
    ctx.logger.warn({ results: results.length }, "some token refreshes failed");
    if (transient instanceof Error) throw transient;
    throw new TransientError("Token refresh failed.");
  }
  return { results };
}

/** The account must be connected again: status, token status, a finding, an audit row. */
async function markReauth(
  ctx: ServiceContext,
  account: SocialAccount,
  code: "TOKEN_INVALID" | "TOKEN_EXPIRED",
  error?: InstagramCallError,
): Promise<TokenRefreshOutcome> {
  await ctx.db
    .update(schema.socialAccounts)
    .set({ status: "NEEDS_REAUTH", tokenStatus: "INVALID" })
    .where(eq(schema.socialAccounts.id, account.id));
  await recordIntegrationEvent(ctx, {
    socialAccountId: account.id,
    severity: "ERROR",
    code,
    message: `@${account.username} must be reconnected: Instagram no longer accepts its token.`,
    details: error
      ? { code: error.error.code, subcode: error.error.subcode, fbtraceId: error.error.fbtraceId }
      : {},
  });
  await audit(ctx, {
    action: "instagram.needs_reauth",
    entityType: "social_account",
    entityId: account.id,
    marketId: account.marketId,
    data: { cause: code },
  });
  return "NEEDS_REAUTH";
}

export { markReauth as markAccountNeedsReauth };
