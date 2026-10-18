import { schema } from "@rc/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "@rc/db/orm";
import { getAiCostOverview } from "../ai";
import {
  ACCOUNT_INSIGHTS_LOCAL_HOUR,
  type AutomaticSlot,
  planSnapshot,
  previousLocalDay,
  SLOT_HOURS,
  type SnapshotSlotName,
} from "../analytics";
import type { ServiceContext } from "../core";
import { getPublishingStatus, STUCK_AFTER_MS } from "../publishing";
import { checkConnectivity } from "./liveness";
import {
  aiProvidersState,
  DAY_MS,
  GENERATING_STUCK_MS,
  type HealthState,
  HOUR_MS,
  type InstagramReason,
  insightsState,
  instagramState,
  jobsState,
  type Probe,
  PUBLISH_FAILURE_WINDOW_MS,
  probeState,
  publishingState,
  RENDER_STUCK_MS,
  SOURCE_STUCK_MS,
  WAITING_AMBER_MS,
  worst,
} from "./rules";

// getSystemHealth (plan 05 §5.11, 12 §12.9, H-01): the indicators of /settings/health and the
// dashboard tiles, read from the database (and one call each to the database and storage for
// their probes). Nothing here calls Instagram or a model: the account standing is what J14 last
// stored, so the page is cheap enough to open at any time.

export type JobDomain = "INGESTION" | "GENERATION" | "PICTURES" | "RENDERS" | "PUBLISHING";
export const JOB_DOMAINS: readonly JobDomain[] = [
  "INGESTION",
  "GENERATION",
  "PICTURES",
  "RENDERS",
  "PUBLISHING",
];

export type StuckKind =
  | "SOURCE_PROCESSING"
  | "VARIANT_GENERATING"
  | "CAROUSEL_RENDER"
  | "REEL_RENDER"
  | "PUBLICATION";

export type StuckItem = {
  kind: StuckKind;
  id: string;
  /** Since when the item has not moved. */
  since: Date;
  /** Where a person looks at it: the source, or the idea's review screen. */
  sourceId?: string;
  ideaId?: string;
  marketCode?: string;
};

export type InstagramIndicator = {
  marketId: string;
  marketCode: string;
  marketName: string;
  flagEmoji: string | null;
  username: string | null;
  state: HealthState;
  reason: InstagramReason;
  daysLeft: number | null;
  quota: { used: number; total: number } | null;
  lastCheckAt: Date | null;
};

export type LateSnapshot = {
  kind: "POST" | "ACCOUNT";
  /** The publication (POST) or the social account (ACCOUNT). */
  id: string;
  /** The post's slot, or the market-local day of the account row. */
  label: string;
  dueAt: Date;
  lagHours: number;
  marketCode: string | null;
};

export type SystemHealth = {
  checkedAt: Date;
  overall: HealthState;
  connectivity: { state: HealthState; db: Probe; storage: Probe };
  instagram: { state: HealthState; accounts: InstagramIndicator[] };
  publishing: {
    state: HealthState;
    mode: "off" | "dry_run_only" | "live";
    enabled: boolean;
    /** Live (not dry-run) publications that FAILED in the last 7 days. */
    failed7d: number;
    /** Posts that should have started more than 15 minutes ago and have not. */
    waiting: number;
    lastFailure: {
      publicationId: string;
      ideaId: string | null;
      at: Date;
      message: string | null;
    } | null;
  };
  jobs: {
    state: HealthState;
    failed24h: Record<JobDomain, number>;
    stuck: StuckItem[];
  };
  insights: {
    state: HealthState;
    /** Snapshots that are due now (posts and account days). */
    due: number;
    oldestLagHours: number | null;
    late: LateSnapshot[];
  };
  aiProviders: {
    state: HealthState;
    runs: number;
    failed: number;
    refused: number;
    invalid: number;
  };
  aiCost: {
    state: HealthState;
    monthToDateUsd: number;
    budgetUsd: number | null;
    share: number | null;
  };
  /** Open WARN and ERROR findings of the integrations, newest first. */
  problems: {
    id: number;
    integration: string;
    severity: "WARN" | "ERROR";
    code: string;
    message: string;
    occurredAt: Date;
  }[];
  /** The newest audit events (what happened, not the details). */
  activity: {
    id: number;
    action: string;
    entityType: string;
    entityId: string | null;
    actorType: "USER" | "SYSTEM" | "JOB";
    occurredAt: Date;
  }[];
};

const STUCK_LIMIT = 20;
/** Posts older than D28 plus its tolerance are no longer measured. */
const MEASURED_FOR_MS = (SLOT_HOURS.D28 + 7 * 24) * HOUR_MS;
const round1 = (n: number) => Math.round(n * 10) / 10;

async function instagramIndicators(ctx: ServiceContext): Promise<InstagramIndicator[]> {
  const now = ctx.clock.now();
  const markets = await ctx.db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.isActive, true))
    .orderBy(asc(schema.markets.sortOrder));
  const accounts = await ctx.db
    .select()
    .from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.platform, "instagram"))
    .orderBy(desc(schema.socialAccounts.connectedAt));
  return markets.map((market) => {
    const mine = accounts.filter((a) => a.marketId === market.id);
    // The same pick as Settings → Instagram: the newest connected account, else the newest.
    const account = mine.find((a) => a.status !== "DISABLED" && a.status !== "REVOKED") ?? mine[0];
    const snapshot = account?.lastHealth ?? null;
    const quota =
      snapshot?.quotaUsage !== undefined && snapshot.quotaTotal !== undefined
        ? { used: snapshot.quotaUsage, total: snapshot.quotaTotal }
        : null;
    const { state, reason } = instagramState({
      status: account?.status ?? null,
      tokenStatus: account?.tokenStatus ?? null,
      tokenExpiresAt: account?.tokenExpiresAt ?? null,
      quota,
      now,
    });
    return {
      marketId: market.id,
      marketCode: market.code,
      marketName: market.displayName,
      flagEmoji: market.flagEmoji,
      username: account?.username ?? null,
      state,
      reason,
      daysLeft: account?.tokenExpiresAt
        ? Math.floor((account.tokenExpiresAt.getTime() - now.getTime()) / DAY_MS)
        : null,
      quota,
      lastCheckAt: account?.lastHealthCheckAt ?? null,
    };
  });
}

async function publishingIndicator(ctx: ServiceContext): Promise<SystemHealth["publishing"]> {
  const now = ctx.clock.now();
  const p = schema.publications;
  const status = await getPublishingStatus(ctx);
  const failures = await ctx.db
    .select({
      id: p.id,
      at: p.updatedAt,
      lastError: p.lastError,
      ideaId: schema.contentVariants.masterIdeaId,
    })
    .from(p)
    .leftJoin(schema.contentVariants, eq(schema.contentVariants.id, p.contentVariantId))
    .where(
      and(
        eq(p.status, "FAILED"),
        eq(p.dryRun, false),
        gte(p.updatedAt, new Date(now.getTime() - PUBLISH_FAILURE_WINDOW_MS)),
      ),
    )
    .orderBy(desc(p.updatedAt));
  const waitingBefore = new Date(now.getTime() - WAITING_AMBER_MS);
  const [waiting] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(p)
    .where(
      or(
        and(eq(p.status, "QUEUED"), lt(p.updatedAt, waitingBefore)),
        and(eq(p.status, "SCHEDULED"), isNotNull(p.scheduledAt), lt(p.scheduledAt, waitingBefore)),
      ),
    );
  const failed7d = failures.length;
  const waitingCount = Number(waiting?.n ?? 0);
  const last = failures[0];
  return {
    state: publishingState({ enabled: status.enabled, failed7d, waiting: waitingCount }),
    mode: status.mode,
    enabled: status.enabled,
    failed7d,
    waiting: waitingCount,
    lastFailure: last
      ? {
          publicationId: last.id,
          ideaId: last.ideaId ?? null,
          at: last.at,
          message: last.lastError?.message ?? null,
        }
      : null,
  };
}

async function failuresByDomain(ctx: ServiceContext): Promise<Record<JobDomain, number>> {
  const since = new Date(ctx.clock.now().getTime() - DAY_MS);
  const count = sql<number>`count(*)::int`;
  const s = schema.sourceAssets;
  const b = schema.knowledgeExtractionBatches;
  const v = schema.contentVariants;
  const p = schema.publications;
  const a = schema.visualAssets;
  const cr = schema.carouselRenders;
  const rr = schema.reelRenders;
  const [sources] = await ctx.db
    .select({ n: count })
    .from(s)
    .where(and(eq(s.processingStatus, "FAILED"), gte(s.updatedAt, since)));
  const [batches] = await ctx.db
    .select({ n: count })
    .from(b)
    .where(and(eq(b.status, "FAILED"), gte(b.updatedAt, since)));
  // A variant that failed while being published is counted under PUBLISHING only.
  const [variants] = await ctx.db
    .select({ n: count })
    .from(v)
    .where(
      and(
        eq(v.status, "FAILED"),
        gte(v.updatedAt, since),
        sql`not exists (select 1 from ${p} where ${p.contentVariantId} = ${v.id} and ${p.status} = 'FAILED' and ${p.updatedAt} >= ${since})`,
      ),
    );
  const [pictures] = await ctx.db
    .select({ n: count })
    .from(a)
    .where(and(eq(a.status, "FAILED"), gte(a.updatedAt, since)));
  const [carousels] = await ctx.db
    .select({ n: count })
    .from(cr)
    .where(
      and(eq(cr.status, "FAILED"), gte(sql`coalesce(${cr.completedAt}, ${cr.createdAt})`, since)),
    );
  const [reels] = await ctx.db
    .select({ n: count })
    .from(rr)
    .where(
      and(eq(rr.status, "FAILED"), gte(sql`coalesce(${rr.completedAt}, ${rr.createdAt})`, since)),
    );
  const [publications] = await ctx.db
    .select({ n: count })
    .from(p)
    .where(and(eq(p.status, "FAILED"), gte(p.updatedAt, since)));
  const n = (row: { n: number } | undefined) => Number(row?.n ?? 0);
  return {
    INGESTION: n(sources) + n(batches),
    GENERATION: n(variants),
    PICTURES: n(pictures),
    RENDERS: n(carousels) + n(reels),
    PUBLISHING: n(publications),
  };
}

async function stuckItems(ctx: ServiceContext): Promise<StuckItem[]> {
  const now = ctx.clock.now().getTime();
  const before = (ms: number) => new Date(now - ms);
  const s = schema.sourceAssets;
  const v = schema.contentVariants;
  const p = schema.publications;
  const m = schema.markets;
  const cr = schema.carouselRenders;
  const rr = schema.reelRenders;
  const items: StuckItem[] = [];

  const sources = await ctx.db
    .select({ id: s.id, since: s.updatedAt })
    .from(s)
    .where(
      and(
        inArray(s.processingStatus, ["QUEUED", "PROCESSING"]),
        isNull(s.archivedAt),
        lt(s.updatedAt, before(SOURCE_STUCK_MS)),
      ),
    )
    .orderBy(asc(s.updatedAt))
    .limit(STUCK_LIMIT);
  for (const r of sources)
    items.push({ kind: "SOURCE_PROCESSING", id: r.id, since: r.since, sourceId: r.id });

  const variants = await ctx.db
    .select({ id: v.id, since: v.updatedAt, ideaId: v.masterIdeaId, marketCode: m.code })
    .from(v)
    .innerJoin(m, eq(m.id, v.marketId))
    .where(and(eq(v.status, "GENERATING"), lt(v.updatedAt, before(GENERATING_STUCK_MS))))
    .orderBy(asc(v.updatedAt))
    .limit(STUCK_LIMIT);
  for (const r of variants) {
    items.push({
      kind: "VARIANT_GENERATING",
      id: r.id,
      since: r.since,
      ideaId: r.ideaId,
      marketCode: r.marketCode,
    });
  }

  for (const [kind, table] of [
    ["CAROUSEL_RENDER", cr],
    ["REEL_RENDER", rr],
  ] as const) {
    const rows = await ctx.db
      .select({ id: table.id, since: table.createdAt, ideaId: v.masterIdeaId, marketCode: m.code })
      .from(table)
      .innerJoin(v, eq(v.id, table.contentVariantId))
      .innerJoin(m, eq(m.id, v.marketId))
      .where(
        and(
          inArray(table.status, ["PENDING", "RENDERING"]),
          lt(table.createdAt, before(RENDER_STUCK_MS)),
        ),
      )
      .orderBy(asc(table.createdAt))
      .limit(STUCK_LIMIT);
    for (const r of rows) {
      items.push({ kind, id: r.id, since: r.since, ideaId: r.ideaId, marketCode: r.marketCode });
    }
  }

  // The dispatcher gives these a new job after 30 minutes; one still here has not recovered.
  const publications = await ctx.db
    .select({ id: p.id, since: p.updatedAt, ideaId: v.masterIdeaId, marketCode: m.code })
    .from(p)
    .innerJoin(v, eq(v.id, p.contentVariantId))
    .innerJoin(m, eq(m.id, p.marketId))
    .where(
      and(eq(p.status, "IN_PROGRESS"), lt(p.updatedAt, before(STUCK_AFTER_MS + WAITING_AMBER_MS))),
    )
    .orderBy(asc(p.updatedAt))
    .limit(STUCK_LIMIT);
  for (const r of publications) {
    items.push({
      kind: "PUBLICATION",
      id: r.id,
      since: r.since,
      ideaId: r.ideaId,
      marketCode: r.marketCode,
    });
  }

  return items.sort((x, y) => x.since.getTime() - y.since.getTime()).slice(0, STUCK_LIMIT);
}

async function insightsIndicator(ctx: ServiceContext): Promise<SystemHealth["insights"]> {
  const now = ctx.clock.now();
  const p = schema.publications;
  const m = schema.markets;
  const posts = await ctx.db
    .select({ id: p.id, publishedAt: p.publishedAt, marketCode: m.code })
    .from(p)
    .innerJoin(m, eq(m.id, p.marketId))
    .where(
      and(
        eq(p.status, "PUBLISHED"),
        eq(p.dryRun, false),
        isNotNull(p.instagramMediaId),
        isNotNull(p.socialAccountId),
        gte(p.publishedAt, new Date(now.getTime() - MEASURED_FOR_MS)),
      ),
    );
  const ids = posts.map((x) => x.id);
  const snapshots = ids.length
    ? await ctx.db
        .select({
          publicationId: schema.metricSnapshots.publicationId,
          slot: schema.metricSnapshots.snapshotSlot,
          age: schema.metricSnapshots.mediaAgeHours,
        })
        .from(schema.metricSnapshots)
        .where(inArray(schema.metricSnapshots.publicationId, ids))
    : [];
  const late: LateSnapshot[] = [];
  for (const post of posts) {
    if (!post.publishedAt) continue;
    const plan = planSnapshot({
      publishedAt: post.publishedAt,
      now,
      existing: snapshots
        .filter((x) => x.publicationId === post.id)
        .map((x) => ({ slot: x.slot as SnapshotSlotName, ageHours: Number(x.age) })),
    });
    if (!plan) continue;
    late.push({
      kind: "POST",
      id: post.id,
      label: plan.slot satisfies AutomaticSlot,
      dueAt: plan.dueAt,
      lagHours: round1((now.getTime() - plan.dueAt.getTime()) / HOUR_MS),
      marketCode: post.marketCode,
    });
  }

  // Account metrics (J12): the market-local day before is due from 02:00 local on.
  const accounts = await ctx.db
    .select({
      id: schema.socialAccounts.id,
      connectedAt: schema.socialAccounts.connectedAt,
      timezone: m.timezone,
      marketCode: m.code,
      lastDay: sql<
        string | null
      >`(select max(${schema.accountMetricSnapshots.metricDate})::text from ${schema.accountMetricSnapshots} where ${schema.accountMetricSnapshots.socialAccountId} = ${schema.socialAccounts.id})`,
    })
    .from(schema.socialAccounts)
    .innerJoin(m, eq(m.id, schema.socialAccounts.marketId))
    .where(
      and(
        eq(schema.socialAccounts.platform, "instagram"),
        eq(schema.socialAccounts.status, "ACTIVE"),
      ),
    );
  for (const account of accounts) {
    const expected = previousLocalDay(
      new Date(now.getTime() - ACCOUNT_INSIGHTS_LOCAL_HOUR * HOUR_MS),
      account.timezone,
    );
    const dueAt = new Date((expected.until + 1) * 1000 + ACCOUNT_INSIGHTS_LOCAL_HOUR * HOUR_MS);
    if ((account.lastDay ?? "") >= expected.metricDate) continue;
    // An account connected after that day ended owes nothing for it.
    if (account.connectedAt.getTime() > (expected.until + 1) * 1000) continue;
    late.push({
      kind: "ACCOUNT",
      id: account.id,
      label: expected.metricDate,
      dueAt,
      lagHours: round1((now.getTime() - dueAt.getTime()) / HOUR_MS),
      marketCode: account.marketCode,
    });
  }

  late.sort((x, y) => y.lagHours - x.lagHours);
  const oldestLagHours = late[0]?.lagHours ?? null;
  return {
    state: insightsState(oldestLagHours),
    due: late.length,
    oldestLagHours,
    late: late.slice(0, STUCK_LIMIT),
  };
}

export async function getSystemHealth(ctx: ServiceContext): Promise<SystemHealth> {
  const checkedAt = ctx.clock.now();
  const connectivity = await checkConnectivity(ctx);
  const instagram = await instagramIndicators(ctx);
  const publishing = await publishingIndicator(ctx);
  const failed24h = await failuresByDomain(ctx);
  const stuck = await stuckItems(ctx);
  const insights = await insightsIndicator(ctx);
  const ai = await getAiCostOverview(ctx);
  const problems = await ctx.db
    .select({
      id: schema.integrationEvents.id,
      integration: schema.integrationEvents.integration,
      severity: schema.integrationEvents.severity,
      code: schema.integrationEvents.code,
      message: schema.integrationEvents.message,
      occurredAt: schema.integrationEvents.occurredAt,
    })
    .from(schema.integrationEvents)
    .where(
      and(
        isNull(schema.integrationEvents.resolvedAt),
        inArray(schema.integrationEvents.severity, ["WARN", "ERROR"]),
      ),
    )
    .orderBy(desc(schema.integrationEvents.occurredAt))
    .limit(20);
  const activity = await ctx.db
    .select({
      id: schema.auditEvents.id,
      action: schema.auditEvents.action,
      entityType: schema.auditEvents.entityType,
      entityId: schema.auditEvents.entityId,
      actorType: schema.auditEvents.actorType,
      occurredAt: schema.auditEvents.occurredAt,
    })
    .from(schema.auditEvents)
    .orderBy(desc(schema.auditEvents.occurredAt), desc(schema.auditEvents.id))
    .limit(15);

  const failedTotal = Object.values(failed24h).reduce((sum, n) => sum + n, 0);
  const result: Omit<SystemHealth, "overall"> = {
    checkedAt,
    connectivity: {
      state: worst([probeState(connectivity.db), probeState(connectivity.storage)]),
      ...connectivity,
    },
    instagram: { state: worst(instagram.map((a) => a.state)), accounts: instagram },
    publishing,
    jobs: { state: jobsState({ failed24h: failedTotal, stuck: stuck.length }), failed24h, stuck },
    insights,
    aiProviders: { state: aiProvidersState(ai.last24h), ...ai.last24h },
    aiCost: {
      state: ai.state,
      monthToDateUsd: ai.monthToDateUsd,
      budgetUsd: ai.budgetUsd,
      share: ai.share,
    },
    problems: problems.map((x) => ({ ...x, severity: x.severity as "WARN" | "ERROR" })),
    activity,
  };
  return {
    ...result,
    overall: worst([
      result.connectivity.state,
      result.instagram.state,
      result.publishing.state,
      result.jobs.state,
      result.insights.state,
      result.aiProviders.state,
      result.aiCost.state,
    ]),
  };
}
