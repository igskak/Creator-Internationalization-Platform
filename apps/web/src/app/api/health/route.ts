// Liveness only. H-01 adds DB and storage checks.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ status: "ok" });
}
