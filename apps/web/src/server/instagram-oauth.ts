import "server-only";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS } from "@rc/modules/instagram";
import type { NextResponse } from "next/server";
import { serverEnv } from "./runtime";

// The cookie that holds the signed OAuth state while the owner is on Instagram (plan 09 §9.2).
// httpOnly, SameSite=Lax (the callback is a top-level GET from instagram.com), scoped to the
// OAuth routes and gone after the state's ten minutes.

export const stateCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: serverEnv().appEnv === "production",
  path: "/api/instagram/oauth",
  maxAge: OAUTH_STATE_TTL_MS / 1000,
});

export function setStateCookie(response: NextResponse, state: string): void {
  response.cookies.set(OAUTH_STATE_COOKIE, state, stateCookieOptions());
}

export function clearStateCookie(response: NextResponse): void {
  response.cookies.set(OAUTH_STATE_COOKIE, "", { ...stateCookieOptions(), maxAge: 0 });
}
