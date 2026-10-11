import { handleDataDeletion } from "@rc/modules/instagram";
import { runMetaCallback } from "@/server/meta-callbacks";

// Meta's "data deletion request URL" (plan 09 §9.6, V-13): answers with the status page URL and a
// confirmation code, as Meta requires. Public; authenticated by the HMAC of `signed_request`.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return runMetaCallback(request, async (ctx, signedRequest) =>
    Response.json(await handleDataDeletion(ctx, { signedRequest })),
  );
}
