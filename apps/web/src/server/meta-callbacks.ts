import "server-only";
import { PermanentError } from "@rc/lib/errors";
import { InvalidSignedRequestError } from "@rc/modules/instagram";
import { requestContext } from "./context";

// Shared plumbing of the two Meta callbacks (plan 09 §9.6): both are POSTs with a form field
// `signed_request`, reachable without a session (/api/meta/ is public in the proxy), so the
// signature is the only authentication. Nothing about the request is logged but the outcome.

export async function readSignedRequest(request: Request): Promise<string | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as { signed_request?: unknown };
      return typeof body.signed_request === "string" ? body.signed_request : null;
    }
    const form = await request.formData();
    const value = form.get("signed_request");
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Runs a callback service as SYSTEM and maps its failures to the status codes Meta expects. */
export async function runMetaCallback(
  request: Request,
  run: (
    ctx: Awaited<ReturnType<typeof requestContext>>,
    signedRequest: string,
  ) => Promise<Response>,
): Promise<Response> {
  const signedRequest = await readSignedRequest(request);
  if (!signedRequest) return Response.json({ error: "missing_signed_request" }, { status: 400 });
  const ctx = await requestContext({ type: "SYSTEM" });
  try {
    return await run(ctx, signedRequest);
  } catch (error) {
    if (error instanceof InvalidSignedRequestError) {
      ctx.logger.warn({ reason: error.reason }, "meta callback refused");
      return Response.json({ error: "invalid_signed_request" }, { status: 400 });
    }
    // Publishing is off in this environment: no app secret to check the request with.
    if (error instanceof PermanentError) {
      return Response.json({ error: "not_configured" }, { status: 503 });
    }
    throw error;
  }
}
