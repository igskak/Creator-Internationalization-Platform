import { NotFoundError } from "@rc/lib/errors";
import { getLineage } from "@rc/modules/analytics";
import { getReelView } from "@rc/modules/reels";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LineageView } from "@/components/analytics/lineage";
import { ReelCard } from "@/components/review/reel-card";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /content/published/[publicationId] (plan 10 §10.2, M6-09): where one post came from and how it
// did. For a carousel the Reel card sits here too: a Reel can be made from a post that is out
// (plan 18 RL-3, M8-07).
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LineagePage({
  params,
}: {
  params: Promise<{ publicationId: string }>;
}) {
  const { publicationId } = await params;
  if (!UUID.test(publicationId)) notFound();
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const lineage = await getLineage(ctx, { publicationId }).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const canManage = user.role === "owner" || user.role === "editor";
  const reelView =
    lineage.variant.format === "CAROUSEL" ? await getReelView(ctx, lineage.variant.id) : null;

  return (
    <main className="flex max-w-5xl flex-col gap-4 p-6">
      <Link
        href="/content/published"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {messages.lineage.back}
      </Link>
      <LineageView
        lineage={lineage}
        t={messages.lineage}
        locale={locale}
        canManage={canManage}
        reelCard={reelView ? <ReelCard view={reelView} canManage={canManage} /> : undefined}
      />
    </main>
  );
}
