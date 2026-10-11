import type { schema } from "@rc/db";
import { PermanentError } from "@rc/lib/errors";
import { decrypt, encrypt } from "@rc/lib/security";
import type { ServiceContext } from "../core";

export type SocialAccount = typeof schema.socialAccounts.$inferSelect;

/**
 * The scopes the app asks for (V-02, M5-00). The insights scope is needed from M6; asking now
 * avoids a second consent. If the authorize page rejects it, remove it here and re-check at M6-02.
 */
export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
] as const;

/** Long-lived tokens last ~60 days (5,183,944 s, V-03). */
export const LONG_LIVED_TOKEN_SECONDS = 5_183_944;

function keyRing(ctx: ServiceContext) {
  if (!ctx.instagram.keyRing) {
    throw new PermanentError("No token encryption keys are configured for this context.");
  }
  return ctx.instagram.keyRing;
}

/** AES-256-GCM with the account row id as AAD, so a token cannot be moved to another row (12 §12.3). */
export function encryptAccessToken(ctx: ServiceContext, socialAccountId: string, token: string) {
  return encrypt(token, { keyRing: keyRing(ctx), aad: socialAccountId });
}

/** The plain token, for one call right now. Never store, return to the browser, or log it. */
export function decryptAccessToken(
  ctx: ServiceContext,
  account: Pick<SocialAccount, "id" | "accessTokenEncrypted">,
): string {
  return decrypt(account.accessTokenEncrypted, { keyRing: keyRing(ctx), aad: account.id });
}

/** What the UI may see of an account: never the token. */
export type SocialAccountView = Omit<SocialAccount, "accessTokenEncrypted">;

export function toAccountView(account: SocialAccount): SocialAccountView {
  const { accessTokenEncrypted: _token, ...view } = account;
  return view;
}
