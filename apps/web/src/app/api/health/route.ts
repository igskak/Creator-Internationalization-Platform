import { checkLiveness } from "@rc/modules/health";
import { requestContext } from "@/server/context";
import { serverEnv } from "@/server/runtime";

// GET /api/health (plan 05 §5.11, H-01): for the uptime monitor (H-06). One cheap read each of the
// database and storage; the answer holds states only, never an error text or a secret. 200 with
// `ok` or `degraded` (slow, or storage failing); 503 with `down` when the database fails.
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requestContext({ type: "SYSTEM" });
  const body = await checkLiveness(ctx, serverEnv().observability.release);
  return Response.json(body, {
    status: body.status === "down" ? 503 : 200,
    headers: { "cache-control": "no-store" },
  });
}
