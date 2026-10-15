import {
  EXPERIMENT_DIMENSIONS,
  listExperiments,
  listVisualHypotheses,
} from "@rc/modules/analytics";
import { listMarkets } from "@rc/modules/localization";
import { ExperimentDialog } from "@/components/experiments/experiment-forms";
import { ExperimentList } from "@/components/experiments/experiment-list";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /experiments (plan 10, M7-06): experiments-lite. Create, start, complete or cancel; results from
// the D7 numbers once both arms have their minimum. Drafts join an arm on the review screen.
export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.experiments;
  const [experiments, markets, hypotheses] = await Promise.all([
    listExperiments(ctx),
    listMarkets(ctx),
    listVisualHypotheses(ctx),
  ]);
  const marketChoices = markets
    .filter((m) => m.isActive)
    .map((m) => ({
      id: m.id,
      label: `${m.flagEmoji ? `${m.flagEmoji} ` : ""}${m.displayName}`,
      hypotheses: (hypotheses.get(m.id) ?? []).map((h) => ({
        id: h.id,
        description: h.description,
        status: h.status,
      })),
    }));
  const dimensions = EXPERIMENT_DIMENSIONS.map((d) => ({
    value: d,
    label: (messages.analytics.learning.dimensions as Record<string, string>)[d] ?? d,
  }));
  const canManage = user.role !== "chef";
  return (
    <main className="flex max-w-5xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="max-w-3xl text-muted-foreground">{t.subtitle}</p>
        </div>
        {canManage ? <ExperimentDialog markets={marketChoices} dimensions={dimensions} /> : null}
      </div>
      <ExperimentList
        experiments={experiments}
        markets={marketChoices}
        dimensions={dimensions}
        canManage={canManage}
        t={t}
        locale={locale}
      />
    </main>
  );
}
