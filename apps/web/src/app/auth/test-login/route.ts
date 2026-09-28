import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isTestLoginAllowed } from "@/server/auth/rules";
import { serverEnv } from "@/server/runtime";
import { supabaseAdmin, supabaseServer } from "@/server/supabase";

// E2E only (plan 12 §12.5, 13 §13.4): creates a session for an email without sending mail.
// Refused in production and without E2E_TEST_AUTH_SECRET; loadServerEnv also refuses the secret
// in production. The allowlist still applies on the next page load.
export async function POST(request: NextRequest) {
  const env = serverEnv();
  const allowed = isTestLoginAllowed({
    appEnv: env.appEnv,
    configuredSecret: env.e2e.testAuthSecret,
    providedSecret: request.headers.get("x-e2e-secret"),
  });
  if (!allowed) return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });

  const body = z.object({ email: z.email() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: { code: "VALIDATION" } }, { status: 400 });

  const admin = supabaseAdmin();
  let link = await admin.auth.admin.generateLink({ type: "magiclink", email: body.data.email });
  if (link.error) {
    await admin.auth.admin.createUser({ email: body.data.email, email_confirm: true });
    link = await admin.auth.admin.generateLink({ type: "magiclink", email: body.data.email });
  }
  const tokenHash = link.data?.properties?.hashed_token;
  if (!tokenHash) return NextResponse.json({ error: { code: "INTERNAL" } }, { status: 500 });

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error) return NextResponse.json({ error: { code: "INTERNAL" } }, { status: 500 });
  return NextResponse.json({ ok: true });
}
