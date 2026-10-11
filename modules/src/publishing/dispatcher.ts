import { schema } from "@rc/db";
import { and, asc, eq, inArray, lt, lte } from "@rc/db/orm";
import { type ServiceContext, withTransaction } from "../core";
import { startPublishJob } from "./queue";
import { isPublishingEnabled } from "./settings";

// J9, the dispatcher (plan 06 §6.3, 09 §9.8, M5-07): every minute it hands the publications that
// are due to the publish job (J10), and finds the ones that fell through a crack.

export const DISPATCH_BATCH = 10;
/** A QUEUED or IN_PROGRESS publication untouched for this long has no live run (the machine saves on every step and poll). */
export const STUCK_AFTER_MS = 30 * 60_000;
/** A QUEUED publication whose job was never started (the runner was down) is picked up after this. */
export const ORPHAN_AFTER_MS = 2 * 60_000;

export type DispatchResult = {
  /** Why nothing live was dispatched, if so. */
  blocked?: "MODE_OFF" | "MODE_DRY_RUN_ONLY" | "KILL_SWITCH";
  dispatched: string[];
  /** Orphans and stuck publications whose job was started again. */
  recovered: string[];
  /** Publications whose job could not be started (put back to wait for the next minute). */
  failedToStart: string[];
};

/**
 * Claims up to `DISPATCH_BATCH` due SCHEDULED publications (oldest first, `FOR UPDATE SKIP LOCKED`,
 * so two dispatchers never take the same row), marks them QUEUED with the market's ACTIVE account,
 * and starts a job for each. With the environment `off` nothing is touched; in `dry_run_only` mode
 * or with the kill switch off only dry runs are dispatched (a live post waits, it does not fail).
 */
export async function dispatchDuePublications(
  ctx: ServiceContext,
  options: { limit?: number } = {},
): Promise<DispatchResult> {
  const result: DispatchResult = { dispatched: [], recovered: [], failedToStart: [] };
  const mode = ctx.instagram.publishMode;
  if (mode === "off") return { ...result, blocked: "MODE_OFF" };
  const liveAllowed = mode === "live" && (await isPublishingEnabled(ctx));
  if (!liveAllowed) result.blocked = mode === "live" ? "KILL_SWITCH" : "MODE_DRY_RUN_ONLY";
  const now = ctx.clock.now();

  const claimed = await withTransaction(ctx, async (tx) => {
    const due = await tx.db
      .select({ id: schema.publications.id, marketId: schema.publications.marketId })
      .from(schema.publications)
      .where(
        and(
          eq(schema.publications.status, "SCHEDULED"),
          lte(schema.publications.scheduledAt, now),
          ...(liveAllowed ? [] : [eq(schema.publications.dryRun, true)]),
        ),
      )
      .orderBy(asc(schema.publications.scheduledAt))
      .limit(options.limit ?? DISPATCH_BATCH)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    const accounts = await tx.db
      .select({ id: schema.socialAccounts.id, marketId: schema.socialAccounts.marketId })
      .from(schema.socialAccounts)
      .where(
        and(
          eq(schema.socialAccounts.platform, "instagram"),
          eq(schema.socialAccounts.status, "ACTIVE"),
          inArray(schema.socialAccounts.marketId, [...new Set(due.map((p) => p.marketId))]),
        ),
      );
    const claimedRows: (typeof schema.publications.$inferSelect)[] = [];
    for (const row of due) {
      const accountId = accounts.find((a) => a.marketId === row.marketId)?.id ?? null;
      const [updated] = await tx.db
        .update(schema.publications)
        .set({ status: "QUEUED", socialAccountId: accountId })
        .where(and(eq(schema.publications.id, row.id), eq(schema.publications.status, "SCHEDULED")))
        .returning();
      if (updated) claimedRows.push(updated);
    }
    return claimedRows;
  });

  for (const publication of claimed) {
    try {
      await startPublishJob(ctx, publication);
      result.dispatched.push(publication.id);
    } catch (error) {
      ctx.logger.error(
        { err: error, publicationId: publication.id },
        "could not start the publish job",
      );
      // Back to waiting: the next minute tries again.
      await ctx.db
        .update(schema.publications)
        .set({ status: "SCHEDULED" })
        .where(
          and(eq(schema.publications.id, publication.id), eq(schema.publications.status, "QUEUED")),
        );
      result.failedToStart.push(publication.id);
    }
  }

  await recover(ctx, result, liveAllowed);
  return result;
}

/** Orphans (QUEUED, never started) and stuck publications get a job again; the machine resumes at its step. */
async function recover(ctx: ServiceContext, result: DispatchResult, liveAllowed: boolean) {
  const now = ctx.clock.now();
  const orphanBefore = new Date(now.getTime() - ORPHAN_AFTER_MS);
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const candidates = await ctx.db
    .select()
    .from(schema.publications)
    .where(
      and(
        inArray(schema.publications.status, ["QUEUED", "IN_PROGRESS"]),
        lt(schema.publications.updatedAt, orphanBefore),
        ...(liveAllowed ? [] : [eq(schema.publications.dryRun, true)]),
      ),
    );
  for (const publication of candidates) {
    const orphan = publication.status === "QUEUED" && publication.triggerRunId === null;
    const stuck = publication.updatedAt < stuckBefore;
    if (!orphan && !stuck) continue;
    if (result.dispatched.includes(publication.id)) continue;
    try {
      // The window number makes one recovery key per half hour, so a stuck post is restarted once
      // per window and a run that is still alive is not doubled.
      await startPublishJob(ctx, publication, {
        ...(orphan ? {} : { recoveryTag: String(Math.floor(now.getTime() / STUCK_AFTER_MS)) }),
      });
      result.recovered.push(publication.id);
    } catch (error) {
      ctx.logger.error(
        { err: error, publicationId: publication.id },
        "could not restart the publish job",
      );
    }
  }
}
