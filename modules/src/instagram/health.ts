import { schema } from "@rc/db";
import type { AccountHealthSnapshot } from "@rc/db/json";
import { and, eq, inArray } from "@rc/db/orm";
import { z } from "zod";
import type { ServiceContext } from "../core";
import { decryptAccessToken } from "./accounts";
import { InstagramCallError } from "./errors";
import { recordIntegrationEvent, resolveIntegrationEvents } from "./events";
import { createGraphClient } from "./http";
import { markAccountNeedsReauth } from "./tokens";

// J14 (plan 06 §6.3, 09 §9.2, M5-04): every six hours each ACTIVE account is asked for its profile
// and its publishing limit. The result is kept in `social_accounts.last_health`.

export const CheckHealthInput = z.object({ socialAccountId: z.uuid().optional() });

const Me = z.object({
  user_id: z.union([z.string(), z.number()]).optional(),
  username: z.string().optional(),
  account_type: z.string().optional(),
});
const Limit = z.object({
  data: z
    .array(
      z.object({
        quota_usage: z.number().int().nonnegative().optional(),
        config: z.object({ quota_total: z.number().int().nonnegative().optional() }).optional(),
      }),
    )
    .optional(),
});

export type HealthCheckResult = {
  socialAccountId: string;
  marketId: string;
  ok: boolean;
  /** Set when the check ended the account's standing (NEEDS_REAUTH). */
  needsReauth?: boolean;
  quota?: { used: number; total: number };
  problem?: string;
};

/**
 * Checks the accounts (ACTIVE only; one when `socialAccountId` is given). A reply of code 190
 * makes the account NEEDS_REAUTH. Any other failure is recorded as a failed snapshot and one open
 * WARN finding, and does not throw: the next run tries again, and a flaky network must not turn a
 * health check into a failing job.
 */
export async function checkInstagramAccountHealth(
  ctx: ServiceContext,
  raw: z.input<typeof CheckHealthInput> = {},
): Promise<{ results: HealthCheckResult[] }> {
  const input = CheckHealthInput.parse(raw);
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
  const results: HealthCheckResult[] = [];

  for (const account of accounts) {
    const now = ctx.clock.now();
    const base = { socialAccountId: account.id, marketId: account.marketId };
    const save = (snapshot: AccountHealthSnapshot, extra: Partial<typeof account> = {}) =>
      ctx.db
        .update(schema.socialAccounts)
        .set({ lastHealth: snapshot, lastHealthCheckAt: now, ...extra })
        .where(eq(schema.socialAccounts.id, account.id));
    try {
      const client = createGraphClient(ctx.instagram, {
        accessToken: decryptAccessToken(ctx, account),
        logger: ctx.logger,
      });
      const me = Me.parse(await client.get("/me", { fields: "user_id,username,account_type" }));
      const limit = Limit.parse(
        await client.get(`/${account.instagramAccountId}/content_publishing_limit`, {
          fields: "quota_usage,config",
        }),
      );
      const entry = limit.data?.[0];
      const quota =
        entry?.quota_usage !== undefined && entry.config?.quota_total !== undefined
          ? { used: entry.quota_usage, total: entry.config.quota_total }
          : undefined;
      const type = me.account_type?.toUpperCase();
      const stillProfessional = !type || type === "BUSINESS" || type === "MEDIA_CREATOR";
      const snapshot: AccountHealthSnapshot = {
        ok: stillProfessional,
        ...(quota ? { quotaUsage: quota.used, quotaTotal: quota.total } : {}),
        ...(stillProfessional ? {} : { error: "The account is no longer a professional account." }),
      };
      await save(
        snapshot,
        me.username && me.username !== account.username ? { username: me.username } : {},
      );
      if (stillProfessional) {
        await resolveIntegrationEvents(ctx, account.id, [
          "HEALTH_CHECK_FAILED",
          "NOT_PROFESSIONAL",
        ]);
      } else {
        await recordIntegrationEvent(ctx, {
          socialAccountId: account.id,
          severity: "ERROR",
          code: "NOT_PROFESSIONAL",
          message: `@${account.username} is no longer a professional Instagram account: publishing will fail.`,
        });
      }
      results.push({ ...base, ok: stillProfessional, ...(quota ? { quota } : {}) });
    } catch (error) {
      if (error instanceof InstagramCallError && error.error.classification === "AUTH") {
        await save({ ok: false, error: "Instagram no longer accepts the token." });
        await markAccountNeedsReauth(ctx, account, "TOKEN_INVALID", error);
        results.push({ ...base, ok: false, needsReauth: true, problem: "AUTH" });
        continue;
      }
      if (!(error instanceof InstagramCallError) && !(error instanceof z.ZodError)) throw error;
      const problem =
        error instanceof InstagramCallError ? error.error.classification : "UNEXPECTED_ANSWER";
      const message =
        error instanceof InstagramCallError
          ? `Instagram could not be reached or refused the check (${problem}).`
          : "Instagram answered in an unexpected way.";
      await save({ ok: false, error: message });
      await recordIntegrationEvent(ctx, {
        socialAccountId: account.id,
        severity: "WARN",
        code: "HEALTH_CHECK_FAILED",
        message: `The health check of @${account.username} failed.`,
        details: { problem },
      });
      results.push({ ...base, ok: false, problem });
    }
  }
  return { results };
}
