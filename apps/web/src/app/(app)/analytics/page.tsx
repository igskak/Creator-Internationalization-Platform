import {
  getCommercial,
  getContentLearning,
  getEngagement,
  getGrowth,
  getOperations,
  getRankedPosts,
  LEARNING_DIMENSIONS,
  listAttributionEvents,
  listAttributionImports,
  listKnownCampaignIds,
  listReasonLabels,
  listUnknownCampaigns,
} from "@rc/modules/analytics";
import { listMarkets } from "@rc/modules/localization";
import { getProductsOverview } from "@rc/modules/offers";
import { listTaxonomyTerms } from "@rc/modules/settings";
import Link from "next/link";
import { CommercialTab } from "@/components/analytics/commercial";
import { ParamSelect } from "@/components/analytics/filters";
import { EngagementTab, GrowthTab, LearningTab, OperationsTab } from "@/components/analytics/tabs";
import {
  ANALYTICS_TABS,
  analyticsHref,
  parseAnalyticsSearch,
  RANGES,
  windowOf,
} from "@/lib/analytics-query";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /analytics (plan 10 §10.2, M6-05 to M6-07): Growth, Engagement, Content learning and Operations
// over a window of 7, 28 or 90 days, for one market or all. The filters sit in one row above the
// content and scope everything below them; they are in the URL, so a view can be shared. The
// Commercial tab (M6-08) also holds the forms for leads and sales.
export const dynamic = "force-dynamic";

const pill = (active: boolean) =>
  cn(
    "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted",
    active && "border-foreground/30 bg-muted font-medium",
  );

/** Taxonomy kinds behind the dimensions that are codes of a list the owner edits. */
const TAXONOMY_KIND: Record<string, string> = {
  category: "category",
  angle: "angle",
  hook_type: "hook_type",
  visual_style: "visual_style",
  cta_type: "cta_type",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { locale, messages } = await getI18n();
  const t = messages.analytics;
  const filters = parseAnalyticsSearch(await searchParams, LEARNING_DIMENSIONS);
  const markets = (await listMarkets(ctx)).filter((m) => m.isActive);
  const selected = markets.find((m) => m.code === filters.market);
  const window = windowOf(new Date(), filters.range);
  // Patterns are only compared inside one market: the learning tab takes the first one by default.
  const learningMarket = selected ?? markets[0];

  const body = await (async () => {
    switch (filters.tab) {
      case "growth":
        return (
          <GrowthTab
            growth={
              await getGrowth(ctx, { ...window, ...(selected ? { marketId: selected.id } : {}) })
            }
            t={t}
            locale={locale}
          />
        );
      case "engagement":
        return (
          <EngagementTab
            engagement={
              await getEngagement(ctx, {
                ...window,
                ...(selected ? { marketId: selected.id } : {}),
              })
            }
            t={t}
            locale={locale}
          />
        );
      case "learning": {
        if (!learningMarket) return null;
        const dimension = filters.dimension as (typeof LEARNING_DIMENSIONS)[number];
        const [learning, ranked, terms, products] = await Promise.all([
          getContentLearning(ctx, { marketId: learningMarket.id, dimension, ...window }),
          getRankedPosts(ctx, { marketId: learningMarket.id, ...window }),
          listTaxonomyTerms(ctx),
          dimension === "offer" ? getProductsOverview(ctx) : Promise.resolve(null),
        ]);
        const offerNames = new Map(
          (products?.products ?? []).flatMap((p) => p.offers.map((o) => [o.id, o.name] as const)),
        );
        const kind = TAXONOMY_KIND[dimension];
        const labels = {
          value: (value: string): string => {
            if (value === "NONE") return t.learning.noValue;
            if (kind) return terms.find((x) => x.kind === kind && x.code === value)?.label ?? value;
            if (dimension === "daypart") {
              return (t.learning.dayparts as Record<string, string>)[value] ?? value;
            }
            if (dimension === "weekday") {
              return (t.learning.weekdays as Record<string, string>)[value] ?? value;
            }
            if (dimension === "format")
              return (t.formats as Record<string, string>)[value] ?? value;
            if (dimension === "offer") return offerNames.get(value) ?? value;
            return value;
          },
        };
        return (
          <LearningTab learning={learning} ranked={ranked} t={t} locale={locale} labels={labels} />
        );
      }
      case "commercial": {
        const scope = selected ? { marketId: selected.id } : {};
        const [commercial, unknown, events, imports, known] = await Promise.all([
          getCommercial(ctx, { ...window, ...scope }),
          listUnknownCampaigns(ctx),
          listAttributionEvents(ctx, { limit: 10, ...scope }),
          listAttributionImports(ctx),
          user.role === "chef" ? Promise.resolve([]) : listKnownCampaignIds(ctx),
        ]);
        return (
          <CommercialTab
            commercial={commercial}
            unknown={unknown}
            events={events}
            imports={imports}
            markets={markets.map((m) => ({
              id: m.id,
              code: m.code,
              label: `${m.flagEmoji ? `${m.flagEmoji} ` : ""}${m.displayName}`,
            }))}
            knownCampaigns={known}
            canEdit={user.role !== "chef"}
            isOwner={user.role === "owner"}
            t={t}
            locale={locale}
          />
        );
      }
      case "operations":
        return (
          <OperationsTab
            operations={
              await getOperations(ctx, {
                ...window,
                ...(selected ? { marketId: selected.id } : {}),
              })
            }
            t={t}
            locale={locale}
            reasonLabels={await listReasonLabels(ctx)}
          />
        );
    }
  })();

  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground">{t.subtitle}</p>
      </div>

      <nav aria-label={t.title} className="flex flex-wrap gap-1.5">
        {ANALYTICS_TABS.map((tab) => (
          <Link
            key={tab}
            href={analyticsHref(filters, { tab })}
            aria-current={filters.tab === tab ? "page" : undefined}
            className={pill(filters.tab === tab)}
          >
            {t.tabs[tab]}
          </Link>
        ))}
      </nav>

      {/* One row of filters above the content; they scope every number below. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="analytics-filters">
        {/* biome-ignore lint/a11y/useSemanticElements: a row of links, not a form group */}
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={t.filters.range}
        >
          {RANGES.map((range) => (
            <Link
              key={range}
              href={analyticsHref(filters, { range })}
              aria-current={filters.range === range ? "true" : undefined}
              className={pill(filters.range === range)}
            >
              {t.filters.days[range]}
            </Link>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a row of links, not a form group */}
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={t.filters.market}
        >
          {filters.tab !== "learning" ? (
            <Link
              href={analyticsHref(filters, { market: undefined })}
              aria-current={!selected ? "true" : undefined}
              className={pill(!selected)}
            >
              {t.filters.allMarkets}
            </Link>
          ) : null}
          {markets.map((m) => (
            <Link
              key={m.code}
              href={analyticsHref(filters, { market: m.code })}
              aria-current={
                (filters.tab === "learning" ? learningMarket : selected)?.code === m.code
                  ? "true"
                  : undefined
              }
              className={pill(
                (filters.tab === "learning" ? learningMarket : selected)?.code === m.code,
              )}
            >
              {m.flagEmoji ? <span aria-hidden="true">{m.flagEmoji} </span> : null}
              {m.displayName}
            </Link>
          ))}
        </div>
        {filters.tab === "learning" ? (
          <ParamSelect
            name="dimension"
            value={filters.dimension}
            label={t.filters.dimension}
            options={LEARNING_DIMENSIONS.map((d) => ({
              value: d,
              label: (t.learning.dimensions as Record<string, string>)[d] ?? d,
            }))}
          />
        ) : null}
      </div>

      {body}
    </main>
  );
}
