import { schema } from "@rc/db";
import type { InstagramError } from "@rc/db/json";
import { and, desc, eq, sql } from "@rc/db/orm";
import { InvalidStateError } from "@rc/lib/errors";
import { PRESIGN_TTL } from "@rc/lib/providers/storage";
import { z } from "zod";
import { transitionVariant } from "../content";
import { audit, type ServiceContext, withTransaction } from "../core";
import {
  type ContainerStatus,
  containerError,
  createCarouselContainer,
  createChildContainer,
  createGraphClient,
  createReelContainer,
  decryptAccessToken,
  describeInstagramError,
  type GraphCallRecord,
  type GraphClient,
  getContainerStatus,
  getFollowerCount,
  getMedia,
  getPublishingLimit,
  InstagramCallError,
  isMediaFetchFailure,
  listRecentMedia,
  markAccountNeedsReauth,
  publishContainer,
  recordIntegrationEvent,
} from "../instagram";
import { normalizeCaption } from "./caption";
import {
  checkAllGuards,
  checkQuota,
  checkState,
  checkSwitches,
  GuardFailure,
  loadPublishContext,
  type PublishContext,
  type SocialAccount,
} from "./safeguards";

// The publish state machine (plan 09 §9.4, M5-06). One call runs a publication from its persisted
// step to the end or to the next failure. Every external call is recorded in `publish_attempts`;
// every step persists its result before the next call, so a run that dies resumes where it was.
// The rule that matters most: a `media_publish` whose result is unknown is never repeated blindly.

export const MAX_PUBLISH_ATTEMPTS = 5;
/** How long Instagram may take to process a container (09 §9.4.1). */
export const WAIT_READY_MAX_MS = 10 * 60_000;
/** A Reel's video is downloaded and transcoded by Meta: it gets longer (18 §18.5). */
export const WAIT_READY_REEL_MAX_MS = 15 * 60_000;
const POLL_FAST_MS = 30_000;
const POLL_SLOW_MS = 60_000;
const POLL_FAST_UNTIL_MS = 3 * 60_000;
/** A run that started the publish call this recently may still be waiting for its answer. */
export const PUBLISH_LEASE_MS = 2 * 60_000;
const RECONCILE_LOOKBACK_MS = 60_000;
const RECENT_MEDIA_LIMIT = 25;

export const PUBLISH_STEPS = [
  "GUARDS",
  "CREATE_CHILDREN",
  "CREATE_PARENT",
  "WAIT_READY",
  "PUBLISH",
  "FINALIZE",
] as const;
export type PublishStep = (typeof PUBLISH_STEPS)[number];

export type PublishOutcome =
  | { status: "PUBLISHED"; mediaId: string; permalink: string | null }
  | { status: "DRY_RUN_PASSED" }
  | { status: "FAILED"; error: InstagramError }
  /** Nothing to do: the publication is finished, cancelled, or not yet released by the dispatcher. */
  | { status: "NOOP"; publicationStatus: string }
  /** Another run holds the `media_publish` call; this one stepped aside. */
  | { status: "IN_FLIGHT" };

/**
 * A run that has saved progress within this long, under a different run id, is alive. The machine
 * saves at least every poll (a minute) and a Graph call times out in 30 s, so three minutes of
 * silence mean the run is gone. A retried run keeps its id; a run that stops with a retryable
 * error lets go of the publication (see `handleFailure`).
 */
export const RUN_ALIVE_MS = 3 * 60_000;

type Publication = typeof schema.publications.$inferSelect;

/** The publish result is unknown and the post cannot be found: a person must look (09 §9.4.3). */
const manualCheckRequired = () =>
  new InstagramCallError(
    {
      message:
        "Instagram may already have published this post, but it could not be confirmed. Check the account before trying again.",
      type: "MANUAL_CHECK_REQUIRED",
      classification: "UNKNOWN",
    },
    { ambiguous: true },
  );

const guardError = (error: GuardFailure): InstagramError => ({
  message: error.message,
  type: `GUARD_${error.code}`,
  classification: "PERMANENT",
});

const attemptOutcome = (record: GraphCallRecord) => {
  if (record.ok) return "OK" as const;
  const error = record.error;
  if (error?.ambiguous) return "AMBIGUOUS" as const;
  const c = error?.error.classification;
  return c === "TRANSIENT" || c === "RATE_LIMIT" || c === "UNKNOWN"
    ? ("TRANSIENT_ERROR" as const)
    : ("PERMANENT_ERROR" as const);
};

const attemptFields = (record: GraphCallRecord) => ({
  httpStatus: record.httpStatus ?? null,
  response: record.response ?? null,
  outcome: attemptOutcome(record),
  errorCode: record.error?.error.code === undefined ? null : String(record.error.error.code),
  errorSubcode:
    record.error?.error.subcode === undefined ? null : String(record.error.error.subcode),
  fbtraceId: record.error?.error.fbtraceId ?? null,
  durationMs: record.durationMs,
});

/**
 * Runs the publication. Returns its outcome; a failure that may pass (rate limit, 5xx, an
 * unexpected answer) throws a retryable error and leaves the publication IN_PROGRESS for the next
 * attempt, until `MAX_PUBLISH_ATTEMPTS`, after which it ends as FAILED.
 */
export async function runPublication(
  ctx: ServiceContext,
  input: { publicationId: string },
): Promise<PublishOutcome> {
  const runId = ctx.actor.type === "JOB" ? ctx.actor.jobRunId : `local-${ctx.requestId ?? "run"}`;
  const claimed = await claim(ctx, input.publicationId, runId);
  if ("noop" in claimed) return { status: "NOOP", publicationStatus: claimed.noop };
  if ("inFlight" in claimed) return { status: "IN_FLIGHT" };
  let pc = claimed.context;

  try {
    // The account is fixed on the first run (dispatch time) and kept for the retries.
    pc = await ensureAccount(ctx, pc);
    const machine = new Machine(ctx, pc, runId);
    return await machine.run();
  } catch (error) {
    return handleFailure(ctx, input.publicationId, error);
  }
}

/** Marks the start of a run: QUEUED → IN_PROGRESS, counts the attempt, moves the variant on. */
async function claim(
  ctx: ServiceContext,
  publicationId: string,
  runId: string,
): Promise<{ context: PublishContext } | { noop: string } | { inFlight: true }> {
  return withTransaction(ctx, async (tx) => {
    const [current] = await tx.db
      .select({ row: schema.publications, now: sql<Date>`now()` })
      .from(schema.publications)
      .where(eq(schema.publications.id, publicationId))
      .for("update")
      .then((rows) => rows.map((r) => ({ ...r.row, dbNow: new Date(r.now) })));
    if (!current) throw new InvalidStateError("Publication not found.");
    if (current.status !== "QUEUED" && current.status !== "IN_PROGRESS") {
      return { noop: current.status };
    }
    // Another run is working on it: do not start a second one alongside.
    if (
      current.status === "IN_PROGRESS" &&
      current.triggerRunId !== null &&
      current.triggerRunId !== runId &&
      current.dbNow.getTime() - current.updatedAt.getTime() < RUN_ALIVE_MS
    ) {
      return { inFlight: true as const };
    }
    await tx.db
      .update(schema.publications)
      .set({
        status: "IN_PROGRESS",
        step: current.step ?? "GUARDS",
        attemptCount: current.attemptCount + 1,
        triggerRunId: runId,
      })
      .where(eq(schema.publications.id, publicationId));
    const context = await loadPublishContext(tx, publicationId);
    if (!context.publication.dryRun && context.variant.status === "SCHEDULED") {
      await transitionVariant(tx, {
        variantId: context.variant.id,
        event: "DISPATCH",
        data: { publicationId },
      });
    }
    return { context: await loadPublishContext(tx, publicationId) };
  });
}

/** The market's ACTIVE account, if the publication has none yet; stored on the publication. */
async function ensureAccount(ctx: ServiceContext, pc: PublishContext): Promise<PublishContext> {
  if (pc.account) return pc;
  const [account] = await ctx.db
    .select()
    .from(schema.socialAccounts)
    .where(
      and(
        eq(schema.socialAccounts.marketId, pc.publication.marketId),
        eq(schema.socialAccounts.platform, "instagram"),
        eq(schema.socialAccounts.status, "ACTIVE"),
      ),
    );
  if (!account) return pc;
  await ctx.db
    .update(schema.publications)
    .set({ socialAccountId: account.id })
    .where(eq(schema.publications.id, pc.publication.id));
  return { ...pc, account, publication: { ...pc.publication, socialAccountId: account.id } };
}

class Machine {
  private step: PublishStep;

  constructor(
    private readonly ctx: ServiceContext,
    private pc: PublishContext,
    private readonly runId: string,
  ) {
    this.step = (PUBLISH_STEPS as readonly string[]).includes(pc.publication.step ?? "")
      ? (pc.publication.step as PublishStep)
      : "GUARDS";
  }

  private get publication(): Publication {
    return this.pc.publication;
  }

  private get account(): SocialAccount {
    if (!this.pc.account)
      throw new GuardFailure("NO_ACCOUNT", "This market has no connected Instagram account.");
    return this.pc.account;
  }

  /** The Graph client; every call is written to `publish_attempts` as it finishes. */
  private graph(onCall?: (record: GraphCallRecord) => Promise<void>): GraphClient {
    return createGraphClient(this.ctx.instagram, {
      accessToken: decryptAccessToken(this.ctx, this.account),
      logger: this.ctx.logger,
      onCall: onCall ?? ((record) => this.recordAttempt(record)),
    });
  }

  private async recordAttempt(record: GraphCallRecord): Promise<void> {
    await this.ctx.db.insert(schema.publishAttempts).values({
      publicationId: this.publication.id,
      attemptNo: this.publication.attemptCount,
      step: this.step,
      endpoint: record.endpoint,
      request: record.request,
      triggerRunId: this.runId,
      createdAt: this.ctx.clock.now(),
      ...attemptFields(record),
    });
  }

  /** Saves progress: the step and any columns that changed; keeps the in-memory copy in step. */
  private async save(
    set: Partial<typeof schema.publications.$inferInsert>,
    next?: PublishStep,
  ): Promise<void> {
    if (next) this.step = next;
    const update = { ...set, ...(next ? { step: next } : {}) };
    const [row] = await this.ctx.db
      .update(schema.publications)
      .set(update)
      .where(eq(schema.publications.id, this.publication.id))
      .returning();
    if (row) this.pc = { ...this.pc, publication: row };
  }

  async run(): Promise<PublishOutcome> {
    for (;;) {
      switch (this.step) {
        case "GUARDS":
          await this.guards();
          break;
        case "CREATE_CHILDREN":
          await this.createChildren();
          break;
        case "CREATE_PARENT":
          await this.createParent();
          break;
        case "WAIT_READY": {
          const done = await this.waitReady();
          if (done) return done;
          break;
        }
        case "PUBLISH": {
          const done = await this.publish();
          if (done) return done;
          break;
        }
        case "FINALIZE":
          return this.finalize();
      }
    }
  }

  // --- GUARDS -----------------------------------------------------------------------------

  private async guards(): Promise<void> {
    await checkAllGuards(this.ctx, this.pc);
    if (!this.publication.dryRun) {
      const quota = await getPublishingLimit(this.graph(), this.account.instagramAccountId);
      checkQuota(quota);
    }
    await this.save({}, "CREATE_CHILDREN");
  }

  // --- CREATE_CHILDREN --------------------------------------------------------------------

  private async createChildren(): Promise<void> {
    const { slides, snapshot } = this.pc;
    const altOf = new Map(snapshot.slides.map((s) => [s.id, s.altText]));
    const ids = [...this.publication.igChildrenContainerIds];
    const client = this.graph();
    for (let i = ids.length; i < slides.length; i += 1) {
      const slide = slides[i];
      if (!slide) break;
      ids.push(await this.createChild(client, slide.storageKey, altOf.get(slide.slideId)));
      // One row update per child: a crash keeps the children already made.
      await this.save({ igChildrenContainerIds: [...ids] });
    }
    await this.save({}, "CREATE_PARENT");
  }

  /** One child container. If Meta cannot download the image, the link is made again once. */
  private async createChild(
    client: GraphClient,
    storageKey: string,
    altText: string | undefined,
  ): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      const { url } = await this.ctx.storage.presignGet(storageKey, {
        expiresInSeconds: PRESIGN_TTL.metaFetch,
      });
      try {
        return await createChildContainer(client, this.account.instagramAccountId, url, altText);
      } catch (error) {
        if (
          attempt === 0 &&
          error instanceof InstagramCallError &&
          isMediaFetchFailure(error.error)
        ) {
          this.ctx.logger.warn(
            { publicationId: this.publication.id },
            "media fetch failed, presigning again",
          );
          continue;
        }
        throw error;
      }
    }
  }

  // --- CREATE_PARENT ----------------------------------------------------------------------

  private async createParent(): Promise<void> {
    if (!this.publication.igContainerId && this.pc.format === "REEL") {
      const id = await this.createReel();
      await this.save({ igContainerId: id, igContainerStatus: "IN_PROGRESS" });
    }
    if (!this.publication.igContainerId) {
      await this.waitChildren();
      const id = await createCarouselContainer(this.graph(), this.account.instagramAccountId, {
        childIds: this.publication.igChildrenContainerIds,
        caption: this.pc.caption,
        // Instagram's own "AI info" label, when the approved snapshot asks for it (V-16).
        isAiGenerated: this.pc.snapshot.disclosure?.platformLabel === true,
      });
      await this.save({ igContainerId: id, igContainerStatus: "IN_PROGRESS" });
    }
    await this.save({}, "WAIT_READY");
  }

  /** The Reel container: Meta fetches the approved video from a fresh presigned link (V-26). */
  private async createReel(): Promise<string> {
    const reel = this.pc.snapshot.reel;
    if (!reel) throw new GuardFailure("VERSION_DAMAGED", "The approved Reel has no video.");
    const { url } = await this.ctx.storage.presignGet(reel.videoKey, {
      expiresInSeconds: PRESIGN_TTL.metaFetch,
    });
    // The approved cover, when it was made and is still in storage (R3); else the first frame.
    const coverUrl =
      reel.cover && (await this.ctx.storage.head(reel.cover.key))
        ? (
            await this.ctx.storage.presignGet(reel.cover.key, {
              expiresInSeconds: PRESIGN_TTL.metaFetch,
            })
          ).url
        : undefined;
    return createReelContainer(this.graph(), this.account.instagramAccountId, {
      videoUrl: url,
      ...(coverUrl ? { coverUrl } : {}),
      caption: this.pc.caption,
      shareToFeed: true,
      // Instagram's own "AI info" label, when the approved snapshot asks for it (V-16, V-25).
      isAiGenerated: this.pc.snapshot.disclosure?.platformLabel === true,
      // A trial Reel (M8-11): shown to non-followers first.
      trialGraduation: this.pc.variant.trialGraduation ?? null,
    });
  }

  /** Children are images and finish at once; a slow one is waited for a little, an errored one ends it. */
  private async waitChildren(): Promise<void> {
    const client = this.graph();
    for (const childId of this.publication.igChildrenContainerIds) {
      for (let tries = 0; ; tries += 1) {
        const { status, detail } = await getContainerStatus(client, childId);
        if (status === "FINISHED") break;
        if (status === "ERROR" || status === "EXPIRED") {
          throw new InstagramCallError(containerError(detail));
        }
        if (tries >= 6) {
          throw new InstagramCallError({
            message: "A slide was still being processed by Instagram after a minute.",
            classification: "TRANSIENT",
          });
        }
        await this.ctx.sleep(10_000);
      }
    }
  }

  // --- WAIT_READY -------------------------------------------------------------------------

  /** Returns an outcome for a dry run (it stops here), otherwise moves on to PUBLISH. */
  private async waitReady(): Promise<PublishOutcome | undefined> {
    const containerId = this.publication.igContainerId;
    if (!containerId) {
      await this.save({}, "CREATE_PARENT");
      return undefined;
    }
    const client = this.graph();
    let waited = 0;
    for (;;) {
      const { status, detail } = await getContainerStatus(client, containerId);
      await this.save({ igContainerStatus: status });
      if (status === "FINISHED") break;
      if (status === "PUBLISHED") {
        // Only a live run can find its container already published: leave it to the PUBLISH step.
        await this.save({}, "PUBLISH");
        return undefined;
      }
      if (status === "ERROR") {
        const error = containerError(detail);
        // Meta fetches a Reel's video after it answers: a failed download gets one new link.
        if (this.pc.format === "REEL" && isMediaFetchFailure(error)) {
          await this.recreateAfterFetchError(error);
          return undefined;
        }
        throw new InstagramCallError(error);
      }
      if (status === "EXPIRED") {
        await this.recreateAfterExpiry();
        return undefined;
      }
      const maxWait = this.pc.format === "REEL" ? WAIT_READY_REEL_MAX_MS : WAIT_READY_MAX_MS;
      if (waited >= maxWait) {
        throw new InstagramCallError({
          message: `Instagram did not finish processing the post within ${maxWait / 60_000} minutes.`,
          classification: "TRANSIENT",
        });
      }
      const pause = waited < POLL_FAST_UNTIL_MS ? POLL_FAST_MS : POLL_SLOW_MS;
      await this.ctx.sleep(pause);
      waited += pause;
    }
    if (this.publication.dryRun) {
      // Meta has validated format, size and fetchability; the container expires unused.
      await this.finishDryRun();
      return { status: "DRY_RUN_PASSED" };
    }
    await this.save({}, "PUBLISH");
    return undefined;
  }

  /** An expired container is made again, once: the ids are cleared and the steps run again. */
  private async recreateAfterExpiry(): Promise<void> {
    const [expired] = await this.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.publishAttempts)
      .where(
        and(
          eq(schema.publishAttempts.publicationId, this.publication.id),
          sql`${schema.publishAttempts.response}->>'status_code' = 'EXPIRED'`,
        ),
      );
    if ((expired?.n ?? 0) > 1) {
      throw new InstagramCallError({
        message: "The Instagram container expired again after it was made again.",
        classification: "PERMANENT",
      });
    }
    await this.save(
      { igChildrenContainerIds: [], igContainerId: null, igContainerStatus: null },
      "CREATE_CHILDREN",
    );
  }

  /** A Reel whose video Meta could not fetch is made again once, with a new link; then it fails. */
  private async recreateAfterFetchError(error: InstagramError): Promise<void> {
    const [errored] = await this.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.publishAttempts)
      .where(
        and(
          eq(schema.publishAttempts.publicationId, this.publication.id),
          sql`${schema.publishAttempts.response}->>'status_code' = 'ERROR'`,
        ),
      );
    if ((errored?.n ?? 0) > 1) throw new InstagramCallError(error);
    this.ctx.logger.warn(
      { publicationId: this.publication.id },
      "Reel video fetch failed, making the container again",
    );
    await this.save({ igContainerId: null, igContainerStatus: null }, "CREATE_PARENT");
  }

  private async finishDryRun(): Promise<void> {
    await this.save({ status: "DRY_RUN_PASSED" });
    await audit(this.ctx, {
      action: "publication.dry_run_passed",
      entityType: "publication",
      entityId: this.publication.id,
      marketId: this.publication.marketId,
      data: {
        variantId: this.publication.contentVariantId,
        containerId: this.publication.igContainerId,
      },
    });
  }

  // --- PUBLISH ----------------------------------------------------------------------------

  private async publish(): Promise<PublishOutcome | undefined> {
    // Checked again right before the call that cannot be taken back (09 §9.4.2).
    const fresh = await loadPublishContext(this.ctx, this.publication.id);
    this.pc = fresh.account ? fresh : { ...fresh, account: this.pc.account };
    await checkSwitches(this.ctx, false);
    await checkState(this.ctx, this.pc);
    if (this.publication.instagramMediaId) {
      await this.save({}, "FINALIZE");
      return undefined;
    }
    const containerId = this.publication.igContainerId;
    if (!containerId) {
      await this.save({}, "CREATE_PARENT");
      return undefined;
    }

    const status = (await getContainerStatus(this.graph(), containerId)).status;
    const ambiguous = await this.unresolvedAttempts();
    // Another run sent the call a moment ago and has not answered yet: do not race it.
    if (this.isYoungForeign(ambiguous)) return { status: "IN_FLIGHT" };

    if (status === "PUBLISHED" || ambiguous.length > 0) {
      const verdict = await this.reconcile(status, ambiguous);
      if (verdict === "FOUND") {
        await this.save({}, "FINALIZE");
        return undefined;
      }
      if (verdict === "MANUAL") throw manualCheckRequired();
      // SAFE: the container is FINISHED and the earlier call did not take effect.
    } else if (status === "EXPIRED") {
      await this.recreateAfterExpiry();
      return undefined;
    } else if (status === "ERROR") {
      throw new InstagramCallError(containerError());
    } else if (status === "IN_PROGRESS") {
      await this.save({}, "WAIT_READY");
      return undefined;
    }

    const attemptId = await this.claimPublishCall(containerId);
    if (attemptId === "IN_FLIGHT") return { status: "IN_FLIGHT" };
    return this.callMediaPublish(containerId, attemptId);
  }

  /** AMBIGUOUS `media_publish` attempts of this publication with no media id to show for them. */
  private async unresolvedAttempts() {
    return this.ctx.db
      .select()
      .from(schema.publishAttempts)
      .where(
        and(
          eq(schema.publishAttempts.publicationId, this.publication.id),
          eq(schema.publishAttempts.step, "PUBLISH"),
          eq(schema.publishAttempts.outcome, "AMBIGUOUS"),
        ),
      )
      .orderBy(desc(schema.publishAttempts.createdAt));
  }

  /**
   * The container says PUBLISHED, or an earlier `media_publish` has no known result (09 §9.4.3).
   * PUBLISHED → find our post among the recent media by caption and time; FINISHED → the call did
   * not take effect, publishing again is safe; anything else → a person must look.
   */
  private async reconcile(
    status: ContainerStatus,
    ambiguous: Awaited<ReturnType<Machine["unresolvedAttempts"]>>,
  ): Promise<"FOUND" | "SAFE" | "MANUAL"> {
    const sentAt = (ambiguous.at(-1)?.createdAt ?? this.ctx.clock.now()).getTime();
    if (status === "PUBLISHED") {
      const wanted = normalizeCaption(this.pc.caption);
      const recent = await listRecentMedia(
        this.graph(),
        this.account.instagramAccountId,
        RECENT_MEDIA_LIMIT,
      );
      const match = recent.find(
        (m) =>
          m.caption !== undefined &&
          normalizeCaption(m.caption) === wanted &&
          m.timestamp !== undefined &&
          Date.parse(m.timestamp) >= sentAt - RECONCILE_LOOKBACK_MS,
      );
      if (!match) return "MANUAL";
      await this.save({ instagramMediaId: match.id, permalink: match.permalink ?? null });
      await this.resolveAttempts(ambiguous, "OK", { reconciled: "published", mediaId: match.id });
      this.ctx.logger.warn(
        { publicationId: this.publication.id },
        "reconciled a publish with an unknown result",
      );
      return "FOUND";
    }
    if (status === "FINISHED") {
      await this.resolveAttempts(ambiguous, "TRANSIENT_ERROR", { reconciled: "not_published" });
      return "SAFE";
    }
    return "MANUAL";
  }

  private async resolveAttempts(
    rows: Awaited<ReturnType<Machine["unresolvedAttempts"]>>,
    outcome: "OK" | "TRANSIENT_ERROR",
    note: Record<string, unknown>,
  ): Promise<void> {
    for (const row of rows) {
      await this.ctx.db
        .update(schema.publishAttempts)
        .set({ outcome, response: { ...(row.response ?? {}), ...note } })
        .where(eq(schema.publishAttempts.id, row.id));
    }
  }

  /** An AMBIGUOUS row of another run that is still within the time it may be waiting for its answer. */
  private isYoungForeign(rows: Awaited<ReturnType<Machine["unresolvedAttempts"]>>): boolean {
    const now = this.ctx.clock.now().getTime();
    return rows.some(
      (row) => row.triggerRunId !== this.runId && now - row.createdAt.getTime() < PUBLISH_LEASE_MS,
    );
  }

  /**
   * One run at a time may send `media_publish`: under a lock on the publication, either a young
   * call of another run is found (step aside) or this run's attempt row is written, AMBIGUOUS,
   * before the call is sent. Returns that row's id.
   */
  private async claimPublishCall(containerId: string): Promise<number | "IN_FLIGHT"> {
    return withTransaction(this.ctx, async (tx) => {
      await tx.db
        .select({ id: schema.publications.id })
        .from(schema.publications)
        .where(eq(schema.publications.id, this.publication.id))
        .for("update");
      const rows = await tx.db
        .select()
        .from(schema.publishAttempts)
        .where(
          and(
            eq(schema.publishAttempts.publicationId, this.publication.id),
            eq(schema.publishAttempts.step, "PUBLISH"),
            eq(schema.publishAttempts.outcome, "AMBIGUOUS"),
          ),
        );
      if (this.isYoungForeign(rows)) return "IN_FLIGHT" as const;
      const [attempt] = await tx.db
        .insert(schema.publishAttempts)
        .values({
          publicationId: this.publication.id,
          attemptNo: this.publication.attemptCount,
          step: "PUBLISH",
          endpoint: `/${this.account.instagramAccountId}/media_publish`,
          request: { creation_id: containerId },
          outcome: "AMBIGUOUS",
          triggerRunId: this.runId,
          createdAt: this.ctx.clock.now(),
        })
        .returning({ id: schema.publishAttempts.id });
      if (!attempt) throw new Error("Insert returned no row.");
      return attempt.id;
    });
  }

  /** The call that makes the post public; its attempt row (AMBIGUOUS) already exists. */
  private async callMediaPublish(
    containerId: string,
    attemptId: number,
  ): Promise<PublishOutcome | undefined> {
    const client = this.graph(async (record) => {
      // A 5xx may still have published: only an answer with a Graph error body is definitive.
      const fields = attemptFields(record);
      const definitive =
        record.ok || (record.error && !record.error.ambiguous && (record.httpStatus ?? 500) < 500);
      await this.ctx.db
        .update(schema.publishAttempts)
        .set({ ...fields, outcome: definitive ? fields.outcome : "AMBIGUOUS" })
        .where(eq(schema.publishAttempts.id, attemptId));
    });
    let mediaId: string;
    try {
      mediaId = await publishContainer(client, this.account.instagramAccountId, containerId);
    } catch (error) {
      if (
        error instanceof InstagramCallError &&
        (error.ambiguous || (error.error.httpStatus ?? 0) >= 500)
      ) {
        // Unknown result: find out before anything else is done (09 §9.4.3).
        const status = (await getContainerStatus(this.graph(), containerId)).status;
        const rows = await this.unresolvedAttempts();
        const verdict = await this.reconcile(status, rows);
        if (verdict === "FOUND") {
          await this.save({}, "FINALIZE");
          return undefined;
        }
        if (verdict === "SAFE")
          throw new InstagramCallError({ ...error.error, classification: "TRANSIENT" });
        throw manualCheckRequired();
      }
      throw error;
    }
    await this.save({ instagramMediaId: mediaId }, "FINALIZE");
    return undefined;
  }

  // --- FINALIZE ---------------------------------------------------------------------------

  private async finalize(): Promise<PublishOutcome> {
    const mediaId = this.publication.instagramMediaId;
    if (!mediaId) {
      await this.save({}, "PUBLISH");
      throw new InstagramCallError({
        message: "No media id to finalize.",
        classification: "TRANSIENT",
      });
    }
    let permalink = this.publication.permalink;
    let publishedAt: Date | null = null;
    let followers: number | null = null;
    try {
      const client = this.graph();
      const media = await getMedia(client, mediaId);
      permalink = media.permalink ?? permalink;
      publishedAt = media.timestamp ? new Date(media.timestamp) : null;
      followers = (await getFollowerCount(client)) ?? null;
    } catch (error) {
      // The post is public already: a missing permalink must not turn it into a failure.
      this.ctx.logger.warn(
        { publicationId: this.publication.id, err: error instanceof Error ? error.name : "error" },
        "finalize could not read the post",
      );
      await recordIntegrationEvent(this.ctx, {
        socialAccountId: this.account.id,
        severity: "WARN",
        code: "FINALIZE_PARTIAL",
        message: "A post was published but its permalink or follower count could not be read.",
        details: { publicationId: this.publication.id },
      });
    }
    const finishedAt =
      publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : this.ctx.clock.now();
    await withTransaction(this.ctx, async (tx) => {
      const [locked] = await tx.db
        .select({ status: schema.publications.status })
        .from(schema.publications)
        .where(eq(schema.publications.id, this.publication.id))
        .for("update");
      if (locked?.status === "PUBLISHED") return true;
      await tx.db
        .update(schema.publications)
        .set({
          status: "PUBLISHED",
          permalink: permalink ?? null,
          publishedAt: finishedAt,
          followerCountAtPublish: followers,
          lastError: null,
        })
        .where(eq(schema.publications.id, this.publication.id));
      await transitionVariant(tx, {
        variantId: this.publication.contentVariantId,
        event: "PUBLISH_SUCCESS",
        data: { publicationId: this.publication.id, mediaId },
      });
      await audit(tx, {
        action: "publication.published",
        entityType: "publication",
        entityId: this.publication.id,
        marketId: this.publication.marketId,
        data: { variantId: this.publication.contentVariantId, mediaId, permalink },
      });
    });
    return { status: "PUBLISHED", mediaId, permalink: permalink ?? null };
  }
}

/** Turns what went wrong into a retry, or into a FAILED publication a person can read. */
async function handleFailure(
  ctx: ServiceContext,
  publicationId: string,
  error: unknown,
): Promise<PublishOutcome> {
  if (error instanceof GuardFailure) {
    return fail(ctx, publicationId, guardError(error));
  }
  if (error instanceof z.ZodError) {
    error = new InstagramCallError({
      message: "Instagram answered in an unexpected way.",
      classification: "UNKNOWN",
    });
  }
  if (error instanceof InstagramCallError) {
    const c = error.error.classification;
    if (c === "AUTH") {
      const pc = await loadPublishContext(ctx, publicationId);
      if (pc.account) await markAccountNeedsReauth(ctx, pc.account, "TOKEN_INVALID", error);
    }
    const retryable = c === "TRANSIENT" || c === "RATE_LIMIT" || c === "UNKNOWN";
    if (!retryable || error.error.type === "MANUAL_CHECK_REQUIRED") {
      return fail(ctx, publicationId, error.error);
    }
    const [row] = await ctx.db
      .select({ attemptCount: schema.publications.attemptCount })
      .from(schema.publications)
      .where(eq(schema.publications.id, publicationId));
    if ((row?.attemptCount ?? 0) >= MAX_PUBLISH_ATTEMPTS) {
      return fail(ctx, publicationId, error.error);
    }
    // Leave IN_PROGRESS: the runner retries and the run resumes at the saved step. Let go of the
    // publication so that the retry, whatever its run id, can take it up at once.
    await ctx.db
      .update(schema.publications)
      .set({ triggerRunId: null })
      .where(eq(schema.publications.id, publicationId));
    throw error.toAppError();
  }
  throw error;
}

/** FAILED with a readable error; the variant follows (not for a dry run). */
async function fail(
  ctx: ServiceContext,
  publicationId: string,
  error: InstagramError,
): Promise<PublishOutcome> {
  await withTransaction(ctx, async (tx) => {
    const [publication] = await tx.db
      .update(schema.publications)
      .set({ status: "FAILED", lastError: error })
      .where(eq(schema.publications.id, publicationId))
      .returning();
    if (!publication) return;
    if (!publication.dryRun) {
      const [variant] = await tx.db
        .select({ status: schema.contentVariants.status })
        .from(schema.contentVariants)
        .where(eq(schema.contentVariants.id, publication.contentVariantId));
      if (variant?.status === "PUBLISHING") {
        await transitionVariant(tx, {
          variantId: publication.contentVariantId,
          event: "PUBLISH_FAILURE",
          data: { publicationId, message: error.message },
        });
      }
    }
    await audit(tx, {
      action: "publication.failed",
      entityType: "publication",
      entityId: publicationId,
      marketId: publication.marketId,
      data: {
        variantId: publication.contentVariantId,
        step: publication.step,
        classification: error.classification,
        type: error.type ?? null,
        code: error.code ?? null,
        message: error.message,
      },
    });
    if (error.type === "MANUAL_CHECK_REQUIRED") {
      await recordIntegrationEvent(tx, {
        severity: "ERROR",
        code: "PUBLISH_MANUAL_CHECK",
        message:
          "A post may have been published without being confirmed: check the Instagram account.",
        details: { publicationId },
        ...(publication.socialAccountId ? { socialAccountId: publication.socialAccountId } : {}),
      });
    }
  });
  ctx.logger.warn(
    { publicationId, classification: error.classification, ...describeInstagramError(error) },
    "publication failed",
  );
  return { status: "FAILED", error };
}
