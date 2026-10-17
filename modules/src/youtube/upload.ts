import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import {
  ApprovedSnapshot,
  YOUTUBE_PRIVACY_STATUSES,
  type YouTubeError,
  type YouTubeMetadata,
  type YouTubePrivacyStatus,
} from "@rc/db/json";
import { eq, sql } from "@rc/db/orm";
import { InvalidStateError, PermanentError } from "@rc/lib/errors";
import { decrypt, encrypt } from "@rc/lib/security";
import { audit, type ServiceContext, withTransaction } from "../core";
import {
  createYouTubeClient,
  requireYouTubeApp,
  type UploadAnswer,
  type YouTubeClient,
} from "./client";
import { isRetryableYouTubeError, YouTubeCallError } from "./errors";
import { buildShortMetadata, metadataProblems, namesSourceBrand } from "./metadata";

// The upload machine of one Short (task G-09, docs/design/youtube-shorts.md "Flow"). It follows
// the publish machine's rules (09 §9.4): every step persists before the next call, a run that dies
// resumes at its step, and the call that cannot be taken back (the bytes) is never repeated
// blindly. The resumable session is the idempotency key: one session makes at most one video.

export const MAX_YOUTUBE_ATTEMPTS = 5;
/** Shorts may be up to three minutes; our Reels are ≤ 30 s. */
export const MAX_SHORT_MS = 180_000;
/** How long FINALIZE reads the processing state before it calls the Short published anyway. */
export const FINALIZE_POLLS = 10;
const FINALIZE_POLL_MS = 30_000;
/** A run that saved progress within this long, under another run id, is alive (as RUN_ALIVE_MS). */
export const YOUTUBE_RUN_ALIVE_MS = 3 * 60_000;
const RECONCILE_LOOKBACK_MS = 60_000;
const SETTING_ENABLED = "youtube.enabled";
const SETTING_PRIVACY = "youtube.privacy_status";

export const YOUTUBE_STEPS = ["GUARDS", "UPLOAD", "FINALIZE"] as const;
export type YouTubeStep = (typeof YOUTUBE_STEPS)[number];

export type YouTubeUploadOutcome =
  | { status: "PUBLISHED"; videoId: string; url: string }
  | { status: "DRY_RUN_PASSED"; metadata: YouTubeMetadata }
  | { status: "FAILED"; error: YouTubeError }
  | { status: "NOOP"; uploadStatus: string }
  | { status: "IN_FLIGHT" };

type Upload = typeof schema.youtubeUploads.$inferSelect;

/** A safeguard that does not hold: the upload ends FAILED without a call to YouTube. */
export class YouTubeGuardFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeGuardFailure";
  }
}

const manualCheckRequired = () =>
  new YouTubeCallError({
    message:
      "YouTube may already have this Short, but it could not be confirmed. Check the channel before trying again.",
    type: "MANUAL_CHECK_REQUIRED",
    classification: "UNKNOWN",
  });

/** `youtube.enabled` (missing = off): the owner's switch of live uploads. */
export async function isYouTubeEnabled(ctx: ServiceContext): Promise<boolean> {
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SETTING_ENABLED));
  return row?.value === true;
}

/** `youtube.privacy_status` (missing = private, so the first live upload can be checked first). */
export async function youtubePrivacyStatus(ctx: ServiceContext): Promise<YouTubePrivacyStatus> {
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SETTING_PRIVACY));
  const value = row?.value;
  return (YOUTUBE_PRIVACY_STATUSES as readonly unknown[]).includes(value)
    ? (value as YouTubePrivacyStatus)
    : "private";
}

/** Live uploads need `live` and the owner's switch; a dry run needs only a configured channel. */
export async function checkYouTubeSwitches(ctx: ServiceContext, dryRun: boolean): Promise<void> {
  const mode = ctx.youtube.publishMode;
  if (mode === "off" || !ctx.youtube.app) {
    throw new YouTubeGuardFailure("MODE_OFF", "YouTube uploads are off in this environment.");
  }
  if (dryRun) return;
  if (mode !== "live") {
    throw new YouTubeGuardFailure(
      "MODE_DRY_RUN_ONLY",
      "This environment allows YouTube dry runs only (YOUTUBE_PUBLISH_MODE=dry_run_only).",
    );
  }
  if (!(await isYouTubeEnabled(ctx))) {
    throw new YouTubeGuardFailure(
      "DISABLED",
      "YouTube uploads are switched off (setting youtube.enabled).",
    );
  }
}

const keyRing = (ctx: ServiceContext) => {
  const ring = ctx.instagram.keyRing;
  if (!ring) throw new PermanentError("Token encryption keys are not configured.");
  return ring;
};

/** Short URL of a video. */
export const shortUrl = (videoId: string): string => `https://www.youtube.com/shorts/${videoId}`;

/**
 * Runs one upload. Returns its outcome; a failure that may pass throws a retryable error and
 * leaves the upload IN_PROGRESS for the next attempt, until `MAX_YOUTUBE_ATTEMPTS`.
 */
export async function runYouTubeUpload(
  ctx: ServiceContext,
  input: { uploadId: string },
): Promise<YouTubeUploadOutcome> {
  const runId = ctx.actor.type === "JOB" ? ctx.actor.jobRunId : `local-${ctx.requestId ?? "run"}`;
  const claimed = await claim(ctx, input.uploadId, runId);
  if ("noop" in claimed) return { status: "NOOP", uploadStatus: claimed.noop };
  if ("inFlight" in claimed) return { status: "IN_FLIGHT" };
  try {
    return await new Machine(ctx, claimed.upload).run();
  } catch (error) {
    return handleFailure(ctx, input.uploadId, error);
  }
}

async function claim(
  ctx: ServiceContext,
  uploadId: string,
  runId: string,
): Promise<{ upload: Upload } | { noop: string } | { inFlight: true }> {
  return withTransaction(ctx, async (tx) => {
    const [current] = await tx.db
      .select({ row: schema.youtubeUploads, now: sql<Date>`now()` })
      .from(schema.youtubeUploads)
      .where(eq(schema.youtubeUploads.id, uploadId))
      .for("update");
    if (!current) throw new InvalidStateError("YouTube upload not found.");
    const row = current.row;
    if (row.status !== "QUEUED" && row.status !== "IN_PROGRESS") return { noop: row.status };
    if (
      row.status === "IN_PROGRESS" &&
      row.triggerRunId !== null &&
      row.triggerRunId !== runId &&
      new Date(current.now).getTime() - row.updatedAt.getTime() < YOUTUBE_RUN_ALIVE_MS
    ) {
      return { inFlight: true as const };
    }
    const [updated] = await tx.db
      .update(schema.youtubeUploads)
      .set({ status: "IN_PROGRESS", attemptCount: row.attemptCount + 1, triggerRunId: runId })
      .where(eq(schema.youtubeUploads.id, uploadId))
      .returning();
    if (!updated) throw new InvalidStateError("YouTube upload not found.");
    return { upload: updated };
  });
}

type Source = {
  snapshot: ApprovedSnapshot;
  reel: NonNullable<ApprovedSnapshot["reel"]>;
  language: string;
};

class Machine {
  private step: YouTubeStep;
  private client: YouTubeClient | undefined;
  private video: Uint8Array | undefined;

  constructor(
    private readonly ctx: ServiceContext,
    private upload: Upload,
  ) {
    this.step = (YOUTUBE_STEPS as readonly string[]).includes(upload.step)
      ? (upload.step as YouTubeStep)
      : "GUARDS";
  }

  private get yt(): YouTubeClient {
    this.client ??= createYouTubeClient(this.ctx.youtube, this.ctx.logger);
    return this.client;
  }

  private async save(
    set: Partial<typeof schema.youtubeUploads.$inferInsert>,
    next?: YouTubeStep,
  ): Promise<void> {
    if (next) this.step = next;
    const [row] = await this.ctx.db
      .update(schema.youtubeUploads)
      .set({ ...set, ...(next ? { step: next } : {}) })
      .where(eq(schema.youtubeUploads.id, this.upload.id))
      .returning();
    if (row) this.upload = row;
  }

  async run(): Promise<YouTubeUploadOutcome> {
    for (;;) {
      switch (this.step) {
        case "GUARDS": {
          const done = await this.guards();
          if (done) return done;
          break;
        }
        case "UPLOAD":
          await this.uploadBytes();
          break;
        case "FINALIZE":
          return this.finalize();
      }
    }
  }

  // --- GUARDS -----------------------------------------------------------------------------

  /** Everything is checked against the approved snapshot Instagram published (09 §9.4.2). */
  private async source(): Promise<Source> {
    const app = requireYouTubeApp(this.ctx.youtube);
    const [row] = await this.ctx.db
      .select({
        publication: schema.publications,
        snapshot: schema.contentVariantVersions.snapshot,
        format: schema.contentVariants.format,
        marketCode: schema.markets.code,
        language: schema.markets.language,
      })
      .from(schema.publications)
      .innerJoin(
        schema.contentVariantVersions,
        eq(schema.contentVariantVersions.id, schema.publications.contentVariantVersionId),
      )
      .innerJoin(
        schema.contentVariants,
        eq(schema.contentVariants.id, schema.publications.contentVariantId),
      )
      .innerJoin(schema.markets, eq(schema.markets.id, schema.publications.marketId))
      .where(eq(schema.publications.id, this.upload.publicationId));
    if (!row) throw new YouTubeGuardFailure("NO_SOURCE", "The Instagram publication is gone.");
    const p = row.publication;
    if (p.status !== "PUBLISHED" || p.dryRun) {
      throw new YouTubeGuardFailure(
        "NOT_PUBLISHED",
        "Only a Reel that Instagram has published goes to YouTube.",
      );
    }
    if (
      p.contentVariantId !== this.upload.contentVariantId ||
      p.contentVariantVersionId !== this.upload.contentVariantVersionId ||
      p.marketId !== this.upload.marketId
    ) {
      throw new YouTubeGuardFailure("MISMATCH", "The upload does not match its publication.");
    }
    if (row.marketCode !== app.marketCode) {
      throw new YouTubeGuardFailure(
        "WRONG_MARKET",
        `Only the ${app.marketCode} market's Reels go to this YouTube channel.`,
      );
    }
    const parsed = ApprovedSnapshot.safeParse(row.snapshot);
    const reel = parsed.success ? parsed.data.reel : undefined;
    if (!parsed.success || row.format !== "REEL" || !reel) {
      throw new YouTubeGuardFailure("NOT_A_REEL", "Only Reels go to YouTube Shorts.");
    }
    return { snapshot: parsed.data, reel, language: row.language };
  }

  /** The approved mp4, read once per run and checked against the approved hash and size. */
  private async approvedVideo(reel: Source["reel"]): Promise<Uint8Array> {
    if (this.video) return this.video;
    let bytes: Uint8Array;
    try {
      bytes = await this.ctx.storage.getBytes(reel.videoKey);
    } catch {
      throw new YouTubeGuardFailure("VIDEO_MISSING", "The approved Reel video is not in storage.");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== reel.sha256 || bytes.byteLength !== reel.bytes) {
      throw new YouTubeGuardFailure(
        "VIDEO_CHANGED",
        "The stored Reel video is not the approved one.",
      );
    }
    if (reel.width * 16 !== reel.height * 9) {
      throw new YouTubeGuardFailure("NOT_VERTICAL", "A Short must be a 9:16 video.");
    }
    if (reel.durationMs > MAX_SHORT_MS) {
      throw new YouTubeGuardFailure("TOO_LONG", "A Short may be at most three minutes long.");
    }
    this.video = bytes;
    return bytes;
  }

  /** The token works and belongs to the configured channel (the allowlist of one). */
  private async checkChannel(): Promise<string> {
    const app = requireYouTubeApp(this.ctx.youtube);
    const answer = await this.yt.get<{ items?: { id?: string }[] }>("/channels", {
      part: "id",
      mine: "true",
    });
    const channelId = answer.items?.[0]?.id;
    if (channelId !== app.channelId) {
      throw new YouTubeGuardFailure(
        "WRONG_CHANNEL",
        "The YouTube token belongs to another channel than YOUTUBE_CHANNEL_ID.",
      );
    }
    return channelId;
  }

  private async guards(): Promise<YouTubeUploadOutcome | undefined> {
    await checkYouTubeSwitches(this.ctx, this.upload.dryRun);
    const source = await this.source();
    await this.approvedVideo(source.reel);
    const metadata = buildShortMetadata(source.snapshot, {
      language: source.language,
      privacyStatus: await youtubePrivacyStatus(this.ctx),
    });
    if (namesSourceBrand(metadata)) {
      throw new YouTubeGuardFailure("BRAND_TEXT", "The text names the source brand.");
    }
    const problems = metadataProblems(metadata);
    if (problems.length > 0) throw new YouTubeGuardFailure("METADATA", problems.join(" "));
    if (this.upload.youtubeVideoId) {
      await this.save({ metadata }, "FINALIZE");
      return undefined;
    }
    const channelId = await this.checkChannel();
    await this.save({ metadata, channelId });
    if (this.upload.dryRun) {
      await this.save({ status: "DRY_RUN_PASSED" });
      await audit(this.ctx, {
        action: "youtube.dry_run_passed",
        entityType: "youtube_upload",
        entityId: this.upload.id,
        marketId: this.upload.marketId,
        data: { variantId: this.upload.contentVariantId, publicationId: this.upload.publicationId },
      });
      return { status: "DRY_RUN_PASSED", metadata };
    }
    await this.save({}, "UPLOAD");
    return undefined;
  }

  // --- UPLOAD -----------------------------------------------------------------------------

  private session(): string | undefined {
    const stored = this.upload.uploadSessionEncrypted;
    return stored
      ? decrypt(stored, { keyRing: keyRing(this.ctx), aad: this.upload.id })
      : undefined;
  }

  private async uploadBytes(): Promise<void> {
    if (this.upload.youtubeVideoId) {
      await this.save({}, "FINALIZE");
      return;
    }
    // Checked again right before the bytes go out, which cannot be taken back.
    await checkYouTubeSwitches(this.ctx, false);
    const source = await this.source();
    const bytes = await this.approvedVideo(source.reel);
    const metadata = this.upload.metadata;
    if (!metadata) {
      await this.save({}, "GUARDS");
      return;
    }

    let session = this.session();
    let answer: UploadAnswer | undefined;
    if (session) {
      // A session exists: ask it what it has before anything is sent again.
      answer = await this.yt.queryUpload(session, bytes.byteLength);
      if (answer.kind === "expired") {
        if (this.upload.uploadStartedAt) {
          if (await this.reconcile(metadata)) return;
          throw manualCheckRequired();
        }
        // No byte was ever sent into it: a new session is safe.
        await this.save({ uploadSessionEncrypted: null });
        session = undefined;
        answer = undefined;
      }
    }
    if (!session) {
      session = await this.yt.startUpload({
        resource: {
          snippet: {
            title: metadata.title,
            description: metadata.description,
            tags: metadata.tags,
            categoryId: metadata.categoryId,
            defaultLanguage: metadata.defaultLanguage,
            defaultAudioLanguage: metadata.defaultLanguage,
          },
          status: {
            privacyStatus: metadata.privacyStatus,
            selfDeclaredMadeForKids: metadata.selfDeclaredMadeForKids,
            containsSyntheticMedia: metadata.containsSyntheticMedia,
          },
        },
        bytes: bytes.byteLength,
        contentType: "video/mp4",
        notifySubscribers: true,
      });
      await this.save({
        uploadSessionEncrypted: encrypt(session, {
          keyRing: keyRing(this.ctx),
          aad: this.upload.id,
        }),
        uploadStartedAt: null,
      });
    }

    for (let round = 0; round < 3; round += 1) {
      if (answer?.kind === "done") {
        await this.save(
          { youtubeVideoId: answer.videoId, uploadStatus: answer.uploadStatus ?? null },
          "FINALIZE",
        );
        await audit(this.ctx, {
          action: "youtube.uploaded",
          entityType: "youtube_upload",
          entityId: this.upload.id,
          marketId: this.upload.marketId,
          data: { variantId: this.upload.contentVariantId, videoId: answer.videoId },
        });
        return;
      }
      const offset = answer?.kind === "incomplete" ? answer.received : 0;
      // From here on a lost answer is ambiguous: the next run asks the session first.
      if (!this.upload.uploadStartedAt) await this.save({ uploadStartedAt: this.ctx.clock.now() });
      answer = await this.yt.putBytes(session, bytes, offset);
      if (answer.kind === "expired") throw manualCheckRequired();
    }
    throw new YouTubeCallError({
      message: "YouTube did not take the whole video after three tries.",
      classification: "TRANSIENT",
    });
  }

  /**
   * The session expired after bytes were sent: our Short may exist. Look for it among the
   * channel's latest uploads by title and time; never upload again blindly (09 §9.4.3).
   */
  private async reconcile(metadata: YouTubeMetadata): Promise<boolean> {
    const channels = await this.yt.get<{
      items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
    }>("/channels", { part: "contentDetails", mine: "true" });
    const playlistId = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!playlistId) return false;
    const items = await this.yt.get<{
      items?: {
        snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } };
      }[];
    }>("/playlistItems", { part: "snippet", playlistId, maxResults: "25" });
    const since = (this.upload.uploadStartedAt?.getTime() ?? 0) - RECONCILE_LOOKBACK_MS;
    const match = items.items?.find(
      (i) =>
        i.snippet?.title === metadata.title &&
        i.snippet.publishedAt !== undefined &&
        Date.parse(i.snippet.publishedAt) >= since &&
        typeof i.snippet.resourceId?.videoId === "string",
    );
    const videoId = match?.snippet?.resourceId?.videoId;
    if (!videoId) return false;
    this.ctx.logger.warn(
      { uploadId: this.upload.id },
      "reconciled a YouTube upload with an unknown result",
    );
    await this.save({ youtubeVideoId: videoId }, "FINALIZE");
    return true;
  }

  // --- FINALIZE ---------------------------------------------------------------------------

  private async finalize(): Promise<YouTubeUploadOutcome> {
    const videoId = this.upload.youtubeVideoId;
    if (!videoId) {
      await this.save({}, "UPLOAD");
      throw new YouTubeCallError({
        message: "No video id to finalize.",
        classification: "TRANSIENT",
      });
    }
    let uploadStatus = this.upload.uploadStatus;
    let processingStatus = this.upload.processingStatus;
    let rejection: string | undefined;
    for (let poll = 0; poll < FINALIZE_POLLS; poll += 1) {
      const answer = await this.yt.get<{
        items?: {
          status?: { uploadStatus?: string; rejectionReason?: string; failureReason?: string };
          processingDetails?: { processingStatus?: string };
        }[];
      }>("/videos", { part: "status,processingDetails", id: videoId });
      const item = answer.items?.[0];
      uploadStatus = item?.status?.uploadStatus ?? uploadStatus;
      processingStatus = item?.processingDetails?.processingStatus ?? processingStatus;
      await this.save({ uploadStatus, processingStatus });
      if (uploadStatus === "rejected" || uploadStatus === "failed" || uploadStatus === "deleted") {
        rejection = item?.status?.rejectionReason ?? item?.status?.failureReason ?? uploadStatus;
        break;
      }
      if (uploadStatus === "processed" || processingStatus === "succeeded") break;
      if (poll < FINALIZE_POLLS - 1) await this.ctx.sleep(FINALIZE_POLL_MS);
    }
    if (rejection) {
      throw new YouTubeGuardFailure("REJECTED", `YouTube did not accept the Short (${rejection}).`);
    }
    // Still processing after the polls: the video is on the channel and its link works.
    const url = shortUrl(videoId);
    await withTransaction(this.ctx, async (tx) => {
      await tx.db
        .update(schema.youtubeUploads)
        .set({
          status: "PUBLISHED",
          url,
          publishedAt: this.ctx.clock.now(),
          lastError: null,
          uploadSessionEncrypted: null,
        })
        .where(eq(schema.youtubeUploads.id, this.upload.id));
      await audit(tx, {
        action: "youtube.published",
        entityType: "youtube_upload",
        entityId: this.upload.id,
        marketId: this.upload.marketId,
        data: { variantId: this.upload.contentVariantId, videoId, url },
      });
    });
    return { status: "PUBLISHED", videoId, url };
  }
}

const guardError = (error: YouTubeGuardFailure): YouTubeError => ({
  message: error.message,
  type: `GUARD_${error.code}`,
  classification: "PERMANENT",
});

async function handleFailure(
  ctx: ServiceContext,
  uploadId: string,
  error: unknown,
): Promise<YouTubeUploadOutcome> {
  if (error instanceof YouTubeGuardFailure) return fail(ctx, uploadId, guardError(error));
  if (error instanceof YouTubeCallError) {
    const retryable =
      isRetryableYouTubeError(error.error) && error.error.type !== "MANUAL_CHECK_REQUIRED";
    const [row] = await ctx.db
      .select({ attemptCount: schema.youtubeUploads.attemptCount })
      .from(schema.youtubeUploads)
      .where(eq(schema.youtubeUploads.id, uploadId));
    if (!retryable || (row?.attemptCount ?? 0) >= MAX_YOUTUBE_ATTEMPTS) {
      return fail(ctx, uploadId, error.error);
    }
    // Stay IN_PROGRESS and let go, so that the retry (any run id) resumes at the saved step.
    await ctx.db
      .update(schema.youtubeUploads)
      .set({ triggerRunId: null, lastError: error.error })
      .where(eq(schema.youtubeUploads.id, uploadId));
    throw error.toAppError();
  }
  throw error;
}

async function fail(
  ctx: ServiceContext,
  uploadId: string,
  error: YouTubeError,
): Promise<YouTubeUploadOutcome> {
  await withTransaction(ctx, async (tx) => {
    const [upload] = await tx.db
      .update(schema.youtubeUploads)
      .set({ status: "FAILED", lastError: error })
      .where(eq(schema.youtubeUploads.id, uploadId))
      .returning();
    if (!upload) return;
    await audit(tx, {
      action: "youtube.failed",
      entityType: "youtube_upload",
      entityId: uploadId,
      marketId: upload.marketId,
      data: {
        variantId: upload.contentVariantId,
        step: upload.step,
        classification: error.classification,
        type: error.type ?? null,
        reason: error.reason ?? null,
        message: error.message,
      },
    });
    const event =
      error.classification === "AUTH"
        ? {
            severity: "ERROR" as const,
            code: "YOUTUBE_REAUTH",
            message:
              "YouTube no longer accepts the refresh token: make a new one (docs/runbooks/youtube-shorts.md).",
          }
        : error.type === "MANUAL_CHECK_REQUIRED"
          ? {
              severity: "ERROR" as const,
              code: "YOUTUBE_MANUAL_CHECK",
              message: "A Short may have been uploaded without being confirmed: check the channel.",
            }
          : undefined;
    if (event) {
      await tx.db.insert(schema.integrationEvents).values({
        integration: "youtube",
        ...event,
        details: { uploadId },
      });
    }
  });
  ctx.logger.warn(
    { uploadId, classification: error.classification, type: error.type, reason: error.reason },
    "youtube upload failed",
  );
  return { status: "FAILED", error };
}
