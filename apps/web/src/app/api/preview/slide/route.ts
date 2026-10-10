import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { getSlidePreviewHtml } from "@rc/modules/visuals";
import { getCurrentUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// The live HTML preview of one slide (plan 08 §8.5, M3-13): the same HTML the renderer exports,
// built from the stored slide, optionally with the slot values of an unsaved draft (POST). The page
// is shown in a sandboxed iframe (`srcdoc`), so its script cannot touch the app. Needs a session
// like every /api route (the proxy answers 401 without one).
export const dynamic = "force-dynamic";

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

async function respond(input: {
  variantId: string | null;
  slideId: string | null;
  slots?: Record<string, string>;
}): Promise<Response> {
  const current = await getCurrentUser();
  if (current.status !== "signed-in") {
    return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }
  const ctx = await requestContext({
    type: "USER",
    userId: current.user.id,
    role: current.user.role,
  });
  try {
    const html = await getSlidePreviewHtml(ctx, {
      variantId: input.variantId ?? "",
      slideId: input.slideId ?? "",
      ...(input.slots ? { slots: input.slots } : {}),
    });
    return new Response(html, { headers: HEADERS });
  } catch (error) {
    const status =
      error instanceof NotFoundError
        ? 404
        : error instanceof ValidationError
          ? 400
          : error instanceof InvalidStateError
            ? 409
            : 500;
    if (status === 500) throw error;
    return Response.json(
      {
        error: {
          code: (error as { code?: string }).code ?? "ERROR",
          message: (error as Error).message,
        },
      },
      { status },
    );
  }
}

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return respond({ variantId: params.get("variantId"), slideId: params.get("slideId") });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    variantId?: string;
    slideId?: string;
    slots?: Record<string, string>;
  } | null;
  return respond({
    variantId: body?.variantId ?? null,
    slideId: body?.slideId ?? null,
    ...(body?.slots ? { slots: body.slots } : {}),
  });
}
