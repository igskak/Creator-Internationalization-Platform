import { exportPublishedCsv } from "@rc/modules/analytics";
import { parsePublishedSearch } from "@/lib/published-query";
import { getCurrentUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// GET /content/published/export (M6-09): the Published list, filtered the same way, as a CSV file.
// Any signed-in person may download it; the rows are the ones the page shows.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const current = await getCurrentUser();
  if (current.status !== "signed-in") return new Response("Sign in first.", { status: 401 });
  const { user } = current;
  const url = new URL(request.url);
  const filters = parsePublishedSearch(Object.fromEntries(url.searchParams.entries()));
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { csv, truncated } = await exportPublishedCsv(ctx, {
    ...(filters.market ? { market: filters.market } : {}),
    ...(filters.format ? { format: filters.format } : {}),
  });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="published-${day}.csv"`,
      "cache-control": "no-store",
      ...(truncated ? { "x-truncated": "1" } : {}),
    },
  });
}
