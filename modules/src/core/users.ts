import { schema } from "@rc/db";
import { and, eq, isNull, sql } from "@rc/db/orm";
import { ForbiddenError } from "@rc/lib/errors";
import { audit } from "./audit";
import type { ServiceContext, UserRole } from "./context";

// Internal users (plan 01 D-07): Supabase Auth proves the email; the app_users allowlist decides
// access and role. Roles: owner, editor, chef (10 §10.6).

export type AppUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
};

export type ResolveUserResult =
  | { ok: true; user: AppUser; linked: boolean }
  | { ok: false; reason: "unknown" | "inactive" | "email_linked_to_other_account" };

const columns = {
  id: schema.appUsers.id,
  email: schema.appUsers.email,
  displayName: schema.appUsers.displayName,
  role: schema.appUsers.role,
  isActive: schema.appUsers.isActive,
  authUserId: schema.appUsers.authUserId,
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAppUser(row: { id: string; email: string; displayName: string | null; role: UserRole }) {
  return { id: row.id, email: row.email, displayName: row.displayName, role: row.role };
}

/**
 * Maps a verified Supabase identity to an allowlisted app user. First login links
 * `auth_user_id` by email (audited as `user.linked`). Unknown, inactive or mismatched users are
 * refused.
 */
export async function resolveAppUser(
  ctx: ServiceContext,
  identity: { authUserId: string; email: string },
): Promise<ResolveUserResult> {
  const email = normalizeEmail(identity.email);

  const [byAuthId] = await ctx.db
    .select(columns)
    .from(schema.appUsers)
    .where(eq(schema.appUsers.authUserId, identity.authUserId));
  if (byAuthId) {
    return byAuthId.isActive
      ? { ok: true, user: toAppUser(byAuthId), linked: false }
      : { ok: false, reason: "inactive" };
  }

  const [byEmail] = await ctx.db
    .select(columns)
    .from(schema.appUsers)
    .where(eq(sql`lower(${schema.appUsers.email})`, email));
  if (!byEmail) return { ok: false, reason: "unknown" };
  if (!byEmail.isActive) return { ok: false, reason: "inactive" };
  if (byEmail.authUserId) return { ok: false, reason: "email_linked_to_other_account" };

  const [linked] = await ctx.db
    .update(schema.appUsers)
    .set({ authUserId: identity.authUserId })
    .where(and(eq(schema.appUsers.id, byEmail.id), isNull(schema.appUsers.authUserId)))
    .returning(columns);
  if (!linked) return { ok: false, reason: "email_linked_to_other_account" };
  await audit(
    { ...ctx, actor: { type: "USER", userId: linked.id, role: linked.role } },
    { action: "user.linked", entityType: "app_user", entityId: linked.id },
  );
  return { ok: true, user: toAppUser(linked), linked: true };
}

/** True if a magic link may be sent: the email belongs to an active app user. */
export async function isEmailAllowed(ctx: ServiceContext, email: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: schema.appUsers.id })
    .from(schema.appUsers)
    .where(
      and(
        eq(sql`lower(${schema.appUsers.email})`, normalizeEmail(email)),
        eq(schema.appUsers.isActive, true),
      ),
    );
  return Boolean(row);
}

/** Throws ForbiddenError unless the user has one of the roles. */
export function requireRole(user: AppUser, roles: readonly UserRole[]): AppUser {
  if (!roles.includes(user.role)) {
    throw new ForbiddenError(undefined, { details: { role: user.role, required: [...roles] } });
  }
  return user;
}
