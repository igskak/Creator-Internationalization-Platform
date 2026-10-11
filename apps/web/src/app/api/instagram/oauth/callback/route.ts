import { completeInstagramOAuth, OAUTH_STATE_COOKIE } from "@rc/modules/instagram";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";
import { clearStateCookie } from "@/server/instagram-oauth";

// Step 2 (plan 09 §9.2): Instagram sends the owner back with ?code and ?state. Everything that
// decides is in completeInstagramOAuth; this route only reads the request, calls it and redirects
// to /settings/instagram with a reason code (never the code, token or any account detail beyond
// the username).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const current = await getCurrentUser();
  if (current.status !== "signed-in") {
    return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }
  if (current.user.role !== "owner") {
    return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }
  const params = request.nextUrl.searchParams;
  const ctx = await requestContext({ type: "USER", userId: current.user.id, role: "owner" });
  const result = await completeInstagramOAuth(ctx, {
    code: params.get("code"),
    state: params.get("state"),
    cookieState: request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null,
    denied: params.has("error"),
  });
  const target = new URL("/settings/instagram", request.url);
  if (result.ok) {
    target.searchParams.set("connected", result.username);
  } else {
    target.searchParams.set("error", result.reason);
  }
  const response = NextResponse.redirect(target);
  clearStateCookie(response);
  return response;
}
