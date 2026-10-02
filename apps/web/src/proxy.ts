import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isPublicPath } from "./server/auth/rules";
import { REQUEST_ID_HEADER, resolveRequestId } from "./server/request-id";
import { serverEnv } from "./server/runtime";

/**
 * Next.js 16 proxy (formerly middleware, V-21): refreshes the Supabase session cookies and sends
 * requests without a session to /login (pages) or 401 (API). Not a security boundary on its own:
 * pages and actions check the allowlist again (requireUser). Also sets `x-request-id` on the
 * request (for server components, actions and jobs) and on every response (12 §12.9).
 */
export async function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  // Forward the request with the id; rebuilt after Supabase refreshes cookies.
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return NextResponse.next({ request: { headers } });
  };
  const withId = (res: NextResponse) => {
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  };

  let response = forward();
  const { url, anonKey } = serverEnv().supabase;
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const { pathname, search } = request.nextUrl;
  if (data?.claims || isPublicPath(pathname)) return withId(response);

  if (pathname.startsWith("/api/")) {
    return withId(NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }));
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return withId(NextResponse.redirect(login));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
