import { NextResponse } from "next/server";
import { serverEnv } from "@/server/runtime";

// Manual check for M0-19 (development only; needs a session like every /api route): throws an
// error whose message contains a fake token. In Sentry the event must show the request_id tag and
// `access_token=[REDACTED]`, and no cookies or authorization headers.
export function GET() {
  if (serverEnv().appEnv !== "development") {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }
  throw new Error(
    "Sentry test (M0-19): GET https://graph.instagram.com/me?access_token=IGQV-fake-sentry-test-token failed",
  );
}
