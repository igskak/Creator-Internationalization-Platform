import { notFound } from "next/navigation";
import { CommercialTab } from "@/components/analytics/commercial";
import {
  attributionEventsFixture,
  attributionImportsFixture,
  commercialFixture,
  engagementFixture,
  growthFixture,
  learningFixture,
  lineageFixture,
  operationsFixture,
  rankedFixture,
  summaryFixture,
  unknownCampaignsFixture,
} from "@/components/analytics/fixtures";
import { LineageView } from "@/components/analytics/lineage";
import { SummaryTab } from "@/components/analytics/summary";
import { EngagementTab, GrowthTab, LearningTab, OperationsTab } from "@/components/analytics/tabs";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { isDevToolsEnabled } from "@/server/dev-tools";
import { serverEnv } from "@/server/runtime";

// /dev/analytics: the dashboard tabs on synthetic data, so that they can be looked at (and
// checked in a browser) without a database full of posts. Development only; 404 elsewhere.
export default async function DevAnalyticsPage() {
  if (!isDevToolsEnabled(serverEnv().appEnv)) notFound();
  await requireUser();
  const { locale, messages } = await getI18n();
  const t = messages.analytics;
  const labels = {
    value: (v: string) =>
      v === "NONE" ? t.learning.noValue : v.replaceAll("_", " ").toLowerCase(),
  };
  return (
    <main className="flex max-w-6xl flex-col gap-12 p-6">
      <h1 className="text-2xl font-semibold">Dev: analytics on synthetic data</h1>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.tabs.growth}</h2>
        <GrowthTab growth={growthFixture()} t={t} locale={locale} />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.tabs.engagement}</h2>
        <EngagementTab engagement={engagementFixture()} t={t} locale={locale} />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.tabs.learning}</h2>
        <LearningTab
          learning={learningFixture()}
          ranked={rankedFixture()}
          t={t}
          locale={locale}
          labels={labels}
        />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.tabs.commercial}</h2>
        <CommercialTab
          commercial={commercialFixture()}
          unknown={unknownCampaignsFixture()}
          events={attributionEventsFixture()}
          imports={attributionImportsFixture()}
          markets={[]}
          knownCampaigns={["rc-en-261001-ccc333"]}
          canEdit
          isOwner
          t={t}
          locale={locale}
        />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.tabs.operations}</h2>
        <OperationsTab
          operations={operationsFixture()}
          t={t}
          locale={locale}
          reasonLabels={{
            WEAK_HOOK: "Weak hook",
            TRANSLATIONESE: "Translationese",
            VISUAL_ISSUE: "Visual issue",
          }}
        />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.tabs.summary}</h2>
        <SummaryTab
          summary={summaryFixture()}
          canBuild
          labels={{ value: (_d, v) => labels.value(v) }}
          reasonLabels={{ WEAK_HOOK: "Weak hook", TRANSLATIONESE: "Translationese" }}
          t={t}
          locale={locale}
        />
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Lineage</h2>
        <LineageView lineage={lineageFixture()} t={messages.lineage} locale={locale} canManage />
      </section>
    </main>
  );
}
