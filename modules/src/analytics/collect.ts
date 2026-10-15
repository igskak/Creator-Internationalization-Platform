import { schema } from "@rc/db";
import { and, asc, eq, inArray, isNotNull } from "@rc/db/orm";
import { InvalidStateError, NotFoundError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, triggerJob } from "../core";
import {
  createGraphClient,
  decryptAccessToken,
  getAccountInsights,
  getMediaInsights,
  type InsightsMediaType,
  InstagramCallError,
  loadMetricAvailability,
  markAccountNeedsReauth,
  recordIntegrationEvent,
  rememberUnsupportedMetrics,
  resolveIntegrationEvents,
  toSnapshotColumns,
} from "../instagram";
import { localParts, zonedToUtc } from "../publishing/time";
import {
  type ExistingSnapshot,
  mediaAgeHours,
  type PlannedSnapshot,
  planSnapshot,
  type SnapshotSlotName,
} from "./slots";

// J11 `collect-insights` and J12 `collect-account-insights` (plan 06 §6.3, 11 §11.2, M6-03). Every
// snapshot is a measurement with its real age. One failing post never stops the others; findings
// go to `integration_events` (one open finding per account and code).

/** At most this many posts are measured in one run, the oldest-due first (J11 step 1). */
export const MAX_PER_RUN = 50;

export const CollectInsightsInput = z.object({
  publicationId: z.uuid().optional(),
  /** `MANUAL` with a `publicationId`: measure it now (the "collect now" action). */
  slot: z.literal("MANUAL").optional(),
});
export type CollectInsightsInput = z.input<typeof CollectInsightsInput>;

export type CollectedSnapshot = {
  publicationId: string;
  slot: SnapshotSlotName;
  ageHours: number;
  late: boolean;
  /** Metrics Instagram did not report, as the columns that stayed null. */
  missing: string[];
};

export type CollectInsightsResult = {
  collected: CollectedSnapshot[];
  failed: { publicationId: string; problem: string }[];
  /** Posts left for the next run because of the per-run limit. */
  deferred: number;
};

type Candidate = {
  publicationId: string;
  mediaId: string;
  publishedAt: Date;
  socialAccountId: string;
  mediaType: InsightsMediaType;
};

const MISSING_FIELDS = [
  "reach",
  "views",
  "likes",
  "comments",
  "saves",
  "shares",
  "totalInteractions",
] as const;

const problemOf = (error: unknown): string =>
  error instanceof InstagramCallError
    ? error.error.classification
    : error instanceof z.ZodError
      ? "UNEXPECTED_ANSWER"
      : "ERROR";

/**
 * Takes the snapshots that are due (or one manual snapshot of one post). A post is due for the
 * slot `planSnapshot` names; a slot missed by more than its tolerance is still stored, flagged
 * `late`, with the true age. Posts are measured account by account (one token, one client).
 * Instagram refusing the token makes the account NEEDS_REAUTH and ends that account's posts; a
 * rate limit stops the run and is rethrown for the job runner's backoff (what was stored stays);
 * any other failure is that post's finding.
 */
export async function collectInsights(
  ctx: ServiceContext,
  raw: CollectInsightsInput = {},
  options: { limit?: number } = {},
): Promise<CollectInsightsResult> {
  const input = CollectInsightsInput.parse(raw);
  if (input.slot === "MANUAL" && !input.publicationId) {
    throw new InvalidStateError("A manual snapshot needs the post to measure.");
  }
  const p = schema.publications;
  const rows = await ctx.db
    .select({
      publicationId: p.id,
      mediaId: p.instagramMediaId,
      publishedAt: p.publishedAt,
      socialAccountId: p.socialAccountId,
      format: schema.contentVariants.format,
    })
    .from(p)
    .innerJoin(schema.contentVariants, eq(schema.contentVariants.id, p.contentVariantId))
    .where(
      and(
        eq(p.status, "PUBLISHED"),
        eq(p.dryRun, false),
        isNotNull(p.instagramMediaId),
        isNotNull(p.publishedAt),
        isNotNull(p.socialAccountId),
        ...(input.publicationId ? [eq(p.id, input.publicationId)] : []),
      ),
    );
  const candidates: Candidate[] = rows.flatMap((r) =>
    r.mediaId && r.publishedAt && r.socialAccountId
      ? [
          {
            publicationId: r.publicationId,
            mediaId: r.mediaId,
            publishedAt: r.publishedAt,
            socialAccountId: r.socialAccountId,
            mediaType: (r.format === "REEL" ? "REELS" : "FEED") as InsightsMediaType,
          },
        ]
      : [],
  );
  if (input.publicationId && candidates.length === 0) {
    throw new NotFoundError("That post is not published on Instagram, so it has no insights.", {
      details: { publicationId: input.publicationId },
    });
  }

  const now = ctx.clock.now();
  const existing = candidates.length
    ? await ctx.db
        .select({
          publicationId: schema.metricSnapshots.publicationId,
          slot: schema.metricSnapshots.snapshotSlot,
          age: schema.metricSnapshots.mediaAgeHours,
        })
        .from(schema.metricSnapshots)
        .where(
          inArray(
            schema.metricSnapshots.publicationId,
            candidates.map((c) => c.publicationId),
          ),
        )
    : [];
  const byPublication = new Map<string, ExistingSnapshot[]>();
  for (const e of existing) {
    byPublication.set(e.publicationId, [
      ...(byPublication.get(e.publicationId) ?? []),
      { slot: e.slot, ageHours: Number(e.age) },
    ]);
  }

  type Job = Candidate & {
    plan: Pick<PlannedSnapshot, "ageHours" | "late"> & { slot: SnapshotSlotName; dueAt: Date };
  };
  const due: Job[] = [];
  for (const c of candidates) {
    if (input.slot === "MANUAL") {
      due.push({
        ...c,
        plan: {
          slot: "MANUAL",
          ageHours: mediaAgeHours(c.publishedAt, now),
          late: false,
          dueAt: now,
        },
      });
      continue;
    }
    const plan = planSnapshot({
      publishedAt: c.publishedAt,
      now,
      existing: byPublication.get(c.publicationId) ?? [],
    });
    if (plan) due.push({ ...c, plan });
  }
  due.sort((a, b) => a.plan.dueAt.getTime() - b.plan.dueAt.getTime());
  const todo = due.slice(0, options.limit ?? MAX_PER_RUN);
  const result: CollectInsightsResult = {
    collected: [],
    failed: [],
    deferred: due.length - todo.length,
  };
  if (todo.length === 0) return result;

  const accounts = new Map(
    (
      await ctx.db
        .select()
        .from(schema.socialAccounts)
        .where(inArray(schema.socialAccounts.id, [...new Set(todo.map((j) => j.socialAccountId))]))
        .orderBy(asc(schema.socialAccounts.connectedAt))
    ).map((a) => [a.id, a]),
  );
  const availability = await loadMetricAvailability(ctx);
  let rateLimited: InstagramCallError | undefined;
  const reauth = new Set<string>();
  // An account's finding is closed only by a run in which none of its posts failed: a sibling post
  // that went well must not hide the one that did not.
  const succeeded = new Set<string>();
  const failedAccounts = new Set<string>();

  for (const job of todo) {
    const account = accounts.get(job.socialAccountId);
    if (rateLimited || reauth.has(job.socialAccountId)) continue;
    if (!account || account.status !== "ACTIVE") {
      result.failed.push({ publicationId: job.publicationId, problem: "ACCOUNT_NOT_ACTIVE" });
      continue;
    }
    try {
      const client = createGraphClient(ctx.instagram, {
        accessToken: decryptAccessToken(ctx, account),
        logger: ctx.logger,
      });
      const skip = new Set(availability[job.mediaType] ?? []);
      const insights = await getMediaInsights(client, job.mediaId, job.mediaType, skip);
      if (insights.newlyUnsupported.length > 0) {
        await rememberUnsupportedMetrics(ctx, job.mediaType, insights.newlyUnsupported);
        availability[job.mediaType] = [...skip, ...insights.newlyUnsupported];
      }
      const columns = toSnapshotColumns(insights, job.mediaType);
      await ctx.db
        .insert(schema.metricSnapshots)
        .values({
          publicationId: job.publicationId,
          snapshotSlot: job.plan.slot,
          measuredAt: now,
          mediaAgeHours: String(job.plan.ageHours),
          ...columns,
          rawMetricsJson: insights.raw,
          apiVersion: ctx.instagram.app?.graphApiVersion ?? "unknown",
        })
        .onConflictDoNothing();
      result.collected.push({
        publicationId: job.publicationId,
        slot: job.plan.slot,
        ageHours: job.plan.ageHours,
        late: job.plan.late,
        missing: MISSING_FIELDS.filter((f) => columns[f] === null),
      });
      succeeded.add(account.id);
    } catch (error) {
      failedAccounts.add(account.id);
      if (error instanceof InstagramCallError && error.error.classification === "AUTH") {
        await markAccountNeedsReauth(ctx, account, "TOKEN_INVALID", error);
        reauth.add(account.id);
        result.failed.push({ publicationId: job.publicationId, problem: "AUTH" });
        continue;
      }
      if (error instanceof InstagramCallError && error.error.classification === "RATE_LIMIT") {
        rateLimited = error;
        result.failed.push({ publicationId: job.publicationId, problem: "RATE_LIMIT" });
        await recordIntegrationEvent(ctx, {
          socialAccountId: account.id,
          severity: "WARN",
          code: "INSIGHTS_RATE_LIMITED",
          message: `Instagram is limiting insights calls for @${account.username}; the rest waits for the next run.`,
        });
        continue;
      }
      if (!(error instanceof InstagramCallError) && !(error instanceof z.ZodError)) throw error;
      const problem = problemOf(error);
      result.failed.push({ publicationId: job.publicationId, problem });
      ctx.logger.warn(
        { publicationId: job.publicationId, slot: job.plan.slot, problem },
        "insights snapshot failed",
      );
      await recordIntegrationEvent(ctx, {
        socialAccountId: account.id,
        severity: "WARN",
        code: "INSIGHTS_FAILED",
        message: `Insights of a post of @${account.username} could not be read (${problem}).`,
        details: { publicationId: job.publicationId, slot: job.plan.slot, problem },
      });
    }
  }
  for (const accountId of succeeded) {
    if (!failedAccounts.has(accountId)) {
      await resolveIntegrationEvents(ctx, accountId, ["INSIGHTS_FAILED", "INSIGHTS_RATE_LIMITED"]);
    }
  }
  if (rateLimited) throw rateLimited.toAppError();
  return result;
}

// --- Account insights (J12) ---------------------------------------------------------------------

export const CollectAccountInsightsInput = z.object({ socialAccountId: z.uuid().optional() });

export type AccountInsightsResult = {
  collected: { socialAccountId: string; metricDate: string; unavailable: string[] }[];
  failed: { socialAccountId: string; problem: string }[];
};

/** The market-local day before `now`, as a date and as an inclusive Unix-seconds window. */
export function previousLocalDay(
  now: Date,
  timeZone: string,
): { metricDate: string; since: number; until: number } {
  const today = localParts(now, timeZone);
  const yesterday = new Date(Date.UTC(today.year, today.month - 1, today.day - 1));
  const start = zonedToUtc(
    {
      year: yesterday.getUTCFullYear(),
      month: yesterday.getUTCMonth() + 1,
      day: yesterday.getUTCDate(),
      hour: 0,
      minute: 0,
    },
    timeZone,
  ).utc;
  const end = zonedToUtc(
    { year: today.year, month: today.month, day: today.day, hour: 0, minute: 0 },
    timeZone,
  ).utc;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    metricDate: `${yesterday.getUTCFullYear()}-${pad(yesterday.getUTCMonth() + 1)}-${pad(yesterday.getUTCDate())}`,
    since: Math.floor(start.getTime() / 1000),
    until: Math.floor(end.getTime() / 1000) - 1,
  };
}

/**
 * Takes yesterday's account metrics (the market's local day) for each ACTIVE account, once per
 * day: a second run overwrites the row of the day. A metric Instagram does not give is null; the
 * token being refused makes the account NEEDS_REAUTH; any other failure is the account's finding
 * and does not stop the next account.
 */
export async function collectAccountInsights(
  ctx: ServiceContext,
  raw: z.input<typeof CollectAccountInsightsInput> = {},
): Promise<AccountInsightsResult> {
  const input = CollectAccountInsightsInput.parse(raw);
  const accounts = await ctx.db
    .select({ account: schema.socialAccounts, timezone: schema.markets.timezone })
    .from(schema.socialAccounts)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.socialAccounts.marketId))
    .where(
      and(
        eq(schema.socialAccounts.platform, "instagram"),
        eq(schema.socialAccounts.status, "ACTIVE"),
        ...(input.socialAccountId ? [eq(schema.socialAccounts.id, input.socialAccountId)] : []),
      ),
    );
  const result: AccountInsightsResult = { collected: [], failed: [] };
  const now = ctx.clock.now();

  for (const { account, timezone } of accounts) {
    const day = previousLocalDay(now, timezone);
    try {
      const client = createGraphClient(ctx.instagram, {
        accessToken: decryptAccessToken(ctx, account),
        logger: ctx.logger,
      });
      const insights = await getAccountInsights(client, account.instagramAccountId, day);
      const { unavailable, raw: rawAnswers, ...numbers } = insights;
      const values = {
        socialAccountId: account.id,
        metricDate: day.metricDate,
        measuredAt: now,
        ...numbers,
        raw: rawAnswers,
        apiVersion: ctx.instagram.app?.graphApiVersion ?? "unknown",
      };
      await ctx.db
        .insert(schema.accountMetricSnapshots)
        .values(values)
        .onConflictDoUpdate({
          target: [
            schema.accountMetricSnapshots.socialAccountId,
            schema.accountMetricSnapshots.metricDate,
          ],
          set: { ...numbers, measuredAt: now, raw: rawAnswers, apiVersion: values.apiVersion },
        });
      result.collected.push({
        socialAccountId: account.id,
        metricDate: day.metricDate,
        unavailable,
      });
      await resolveIntegrationEvents(ctx, account.id, ["ACCOUNT_INSIGHTS_FAILED"]);
    } catch (error) {
      if (error instanceof InstagramCallError && error.error.classification === "AUTH") {
        await markAccountNeedsReauth(ctx, account, "TOKEN_INVALID", error);
        result.failed.push({ socialAccountId: account.id, problem: "AUTH" });
        continue;
      }
      if (!(error instanceof InstagramCallError) && !(error instanceof z.ZodError)) throw error;
      const problem = problemOf(error);
      result.failed.push({ socialAccountId: account.id, problem });
      await recordIntegrationEvent(ctx, {
        socialAccountId: account.id,
        severity: "WARN",
        code: "ACCOUNT_INSIGHTS_FAILED",
        message: `The account insights of @${account.username} could not be read (${problem}).`,
        details: { metricDate: day.metricDate, problem },
      });
    }
  }
  return result;
}

// --- "Collect now" ---------------------------------------------------------------------------------

export const RequestMetricsInput = z.object({ publicationId: z.uuid() });

/**
 * The service behind the "collect metrics now" action: checks that the post is published on
 * Instagram and starts J11 for it with the MANUAL slot. A manual snapshot repeats as often as it is
 * asked for; it counts as a measurement of its age, so the automatic slots that come due earlier
 * than it are not taken afterwards.
 */
export async function requestMetricsNow(
  ctx: ServiceContext,
  raw: z.input<typeof RequestMetricsInput>,
): Promise<{ runId: string }> {
  const { publicationId } = RequestMetricsInput.parse(raw);
  const [row] = await ctx.db
    .select({
      status: schema.publications.status,
      dryRun: schema.publications.dryRun,
      mediaId: schema.publications.instagramMediaId,
      marketId: schema.publications.marketId,
    })
    .from(schema.publications)
    .where(eq(schema.publications.id, publicationId));
  if (!row) throw new NotFoundError("Post not found.", { details: { publicationId } });
  if (row.status !== "PUBLISHED" || row.dryRun || !row.mediaId) {
    throw new InvalidStateError("Only a post that is published on Instagram has insights.", {
      details: { publicationId, status: row.status },
    });
  }
  const { runId } = await triggerJob(
    ctx,
    "collect-insights",
    { publicationId, slot: "MANUAL" },
    { tags: [`publication:${publicationId}`] },
  );
  await audit(ctx, {
    action: "insights.collect_requested",
    entityType: "publication",
    entityId: publicationId,
    marketId: row.marketId,
    data: { runId },
  });
  return { runId };
}
