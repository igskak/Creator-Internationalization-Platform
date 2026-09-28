import "server-only";
import { type AppUser, requireRole, resolveAppUser, type UserRole } from "@rc/modules/core";
import { redirect } from "next/navigation";
import { cache } from "react";
import { requestContext } from "../context";
import { supabaseServer } from "../supabase";

export type CurrentUser =
  | { status: "signed-in"; user: AppUser }
  | { status: "signed-out" }
  | { status: "refused"; reason: string };

/** Verified Supabase identity (getClaims checks the JWT) mapped to the app_users allowlist. */
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || typeof claims.email !== "string") return { status: "signed-out" };

  const ctx = await requestContext({ type: "SYSTEM" });
  const result = await resolveAppUser(ctx, { authUserId: claims.sub, email: claims.email });
  if (!result.ok) {
    ctx.logger.warn({ reason: result.reason }, "login refused by allowlist");
    return { status: "refused", reason: result.reason };
  }
  return { status: "signed-in", user: result.user };
});

/** For (app) pages and actions: the allowlisted user, or a redirect to /login. */
export async function requireUser(): Promise<AppUser> {
  const current = await getCurrentUser();
  if (current.status === "signed-in") return current.user;
  if (current.status === "refused") redirect(`/auth/sign-out?error=${current.reason}`);
  redirect("/login");
}

export async function requireAppRole(roles: readonly UserRole[]): Promise<AppUser> {
  return requireRole(await requireUser(), roles);
}
