import { InvalidStateError, NotFoundError, PermanentError } from "@rc/lib/errors";
import { startInstagramOAuth } from "@rc/modules/instagram";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";
import { setStateCookie } from "@/server/instagram-oauth";

// Step 1 of connecting an Instagram account (plan 09 §9.2): owners only; sets the state cookie and
// sends the browser to Instagram. Needs a session like every /api route (the proxy answers 401).
export const dynamic = "force-dynamic";

const back = (request: NextRequest, error: string) =>
  NextResponse.redirect(new URL(`/settings/instagram?error=${error}`, request.url));

export async function GET(request: NextRequest) {
  const current = await getCurrentUser();
  if (current.status !== "signed-in") {
    return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }
  if (current.user.role !== "owner") {
    return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }
  const marketId = request.nextUrl.searchParams.get("marketId");
  if (!marketId) return back(request, "market_not_found");

  const ctx = await requestContext({ type: "USER", userId: current.user.id, role: "owner" });
  try {
    const { authorizeUrl, state } = await startInstagramOAuth(ctx, { marketId });
    const response = NextResponse.redirect(authorizeUrl);
    setStateCookie(response, state);
    return response;
  } catch (error) {
    if (error instanceof NotFoundError) return back(request, "market_not_found");
    // Publishing is off in this environment, or the market is inactive.
    if (error instanceof PermanentError || error instanceof InvalidStateError) {
      return back(request, "not_configured");
    }
    throw error;
  }
}
