import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/server/supabase";

async function signOut(request: NextRequest) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  const error = request.nextUrl.searchParams.get("error");
  const target = new URL("/login", request.url);
  if (error && /^[a-z_]{1,40}$/.test(error)) target.searchParams.set("error", error);
  return NextResponse.redirect(target, { status: 303 });
}

/** Sign-out button (form POST). */
export const POST = signOut;
/** Used by requireUser() to clear a session that the allowlist refused. */
export const GET = signOut;
