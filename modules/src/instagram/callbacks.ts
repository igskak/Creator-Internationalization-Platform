import { randomInt } from "node:crypto";
import { schema } from "@rc/db";
import { and, eq, or, sql } from "@rc/db/orm";
import { ValidationError } from "@rc/lib/errors";
import { parseSignedRequest } from "@rc/lib/security";
import { audit, type ServiceContext } from "../core";
import { requireInstagramApp } from "./http";

// Meta's required callbacks (plan 09 §9.6, M5-05, V-13 verified in M5-00): deauthorize and data
// deletion. Both receive `signed_request` = base64url(HMAC-SHA256 signature) "." base64url(payload),
// signed with the app secret; the payload carries the app-scoped `user_id`. The handlers are
// idempotent: Meta may repeat a request, and a user we do not know is not an error.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const DELETION_CODE_PATTERN = /^[A-Z2-9]{12}$/;

export class InvalidSignedRequestError extends ValidationError {
  constructor(
    readonly reason: "malformed" | "unsupported_algorithm" | "bad_signature" | "no_user",
  ) {
    super("The signed request is not valid.", { details: { reason } });
    this.name = "InvalidSignedRequestError";
  }
}

/** The app-scoped user id of a verified request; throws InvalidSignedRequestError otherwise. */
function verifiedUserId(ctx: ServiceContext, signedRequest: string): string {
  const app = requireInstagramApp(ctx.instagram);
  const parsed = parseSignedRequest(signedRequest, app.appSecret);
  if (!parsed.ok) throw new InvalidSignedRequestError(parsed.reason);
  const userId = parsed.payload.user_id;
  if ((typeof userId !== "string" && typeof userId !== "number") || String(userId) === "") {
    throw new InvalidSignedRequestError("no_user");
  }
  return String(userId);
}

/** The accounts of this Meta user: by the app-scoped id, or by the professional account id. */
async function accountsOf(ctx: ServiceContext, userId: string) {
  return ctx.db
    .select()
    .from(schema.socialAccounts)
    .where(
      and(
        eq(schema.socialAccounts.platform, "instagram"),
        or(
          eq(schema.socialAccounts.appScopedUserId, userId),
          eq(schema.socialAccounts.instagramAccountId, userId),
        ),
      ),
    );
}

/**
 * The user removed the app in Instagram: the matching accounts become REVOKED and their tokens
 * are destroyed. An unknown user is fine (nothing to do). Returns how many accounts changed.
 */
export async function handleDeauthorize(
  ctx: ServiceContext,
  input: { signedRequest: string },
): Promise<{ revoked: number }> {
  const userId = verifiedUserId(ctx, input.signedRequest);
  let revoked = 0;
  for (const account of await accountsOf(ctx, userId)) {
    if (account.status === "REVOKED") continue;
    await ctx.db
      .update(schema.socialAccounts)
      .set({
        status: "REVOKED",
        tokenStatus: "REVOKED",
        accessTokenEncrypted: "revoked",
        tokenExpiresAt: null,
      })
      .where(eq(schema.socialAccounts.id, account.id));
    await ctx.db.insert(schema.integrationEvents).values({
      integration: "instagram",
      socialAccountId: account.id,
      severity: "ERROR",
      code: "DEAUTHORIZED",
      message: `@${account.username} removed the app in Instagram: reconnect it to publish again.`,
      occurredAt: ctx.clock.now(),
    });
    await audit(ctx, {
      action: "instagram.deauthorized",
      entityType: "social_account",
      entityId: account.id,
      marketId: account.marketId,
      data: { username: account.username },
    });
    revoked += 1;
  }
  if (revoked === 0) {
    await audit(ctx, { action: "instagram.deauthorize_unmatched", entityType: "social_account" });
  }
  return { revoked };
}

const newCode = () =>
  Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

/**
 * Data deletion request: the token and the profile data of the matching accounts are removed (the
 * row stays, because posts and audit refer to it, but it is anonymized and cannot be used), and a
 * confirmation code is issued. The code and its time live in the audit trail, which the status
 * page reads. Returns the URL of that page and the code, as Meta requires.
 */
export async function handleDataDeletion(
  ctx: ServiceContext,
  input: { signedRequest: string },
): Promise<{ url: string; confirmation_code: string }> {
  const app = requireInstagramApp(ctx.instagram);
  const userId = verifiedUserId(ctx, input.signedRequest);
  const code = newCode();
  const accounts = await accountsOf(ctx, userId);
  for (const account of accounts) {
    await ctx.db
      .update(schema.socialAccounts)
      .set({
        status: "REVOKED",
        tokenStatus: "REVOKED",
        accessTokenEncrypted: "revoked",
        tokenExpiresAt: null,
        username: `deleted-${account.id.slice(0, 8)}`,
        instagramAccountId: `deleted:${account.id}`,
        appScopedUserId: null,
        accountType: null,
        scopes: [],
        lastHealth: null,
      })
      .where(eq(schema.socialAccounts.id, account.id));
    await audit(ctx, {
      action: "instagram.data_deleted",
      entityType: "social_account",
      entityId: account.id,
      marketId: account.marketId,
      data: { confirmationCode: code },
    });
  }
  await audit(ctx, {
    action: "instagram.data_deletion_requested",
    entityType: "data_deletion",
    data: { confirmationCode: code, accounts: accounts.length },
  });
  const origin = new URL(app.redirectUri).origin;
  return { url: `${origin}/data-deletion?code=${code}`, confirmation_code: code };
}

export type DeletionStatus = { status: "COMPLETED"; requestedAt: Date; accounts: number };

/** What the public status page shows for a confirmation code; null for an unknown or malformed one. */
export async function getDeletionStatus(
  ctx: ServiceContext,
  code: string,
): Promise<DeletionStatus | null> {
  if (!DELETION_CODE_PATTERN.test(code)) return null;
  const [row] = await ctx.db
    .select({ at: schema.auditEvents.occurredAt, data: schema.auditEvents.data })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.action, "instagram.data_deletion_requested"),
        sql`${schema.auditEvents.data}->>'confirmationCode' = ${code}`,
      ),
    );
  if (!row) return null;
  const accounts = (row.data as { accounts?: number }).accounts ?? 0;
  return { status: "COMPLETED", requestedAt: row.at, accounts };
}
