import { handleDeauthorize } from "@rc/modules/instagram";
import { runMetaCallback } from "@/server/meta-callbacks";

// Meta's "deauthorize callback" (plan 09 §9.6, V-13): the owner removed the app in Instagram.
// Public; authenticated by the HMAC of `signed_request` with the app secret.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return runMetaCallback(request, async (ctx, signedRequest) => {
    const { revoked } = await handleDeauthorize(ctx, { signedRequest });
    return Response.json({ ok: true, revoked });
  });
}
