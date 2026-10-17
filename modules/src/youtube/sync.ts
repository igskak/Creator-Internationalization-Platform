import { schema } from "@rc/db";
import type { YouTubeError, YouTubeMetadata } from "@rc/db/json";
import { and, asc, desc, eq, gte, inArray, sql } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import type { PublishMode, ServiceContext } from "../core";
import {
  isYouTubeEnabled,
  runYouTubeUpload,
  type YouTubeUploadOutcome,
  youtubePrivacyStatus,
} from "./upload";

// Which published Reel goes to YouTube next (J25 `sync-youtube-shorts`, task G-09): the cron
// takes one per run, oldest first, and only when the environment and the owner's switch allow
// it. A FAILED upload is never retried here: `retryYouTubeUpload` does that, on purpose.

/** A Reel published on Instagram longer ago than this is not picked by the cron. */
export const SYNC_MAX_AGE_DAYS = 30;

export const SyncYouTubeInput = z.object({}).default({});

export type SyncYouTubeResult =
  | { status: "OFF" | "DISABLED" | "NOTHING_TO_DO" }
  | { status: "RAN"; uploadId: string; outcome: YouTubeUploadOutcome };

/** The upload rows of one kind (live or dry run) that a run may resume. */
async function openUpload(ctx: ServiceContext, dryRun: boolean): Promise<string | undefined> {
  const [row] = await ctx.db
    .select({ id: schema.youtubeUploads.id })
    .from(schema.youtubeUploads)
    .where(
      and(
        eq(schema.youtubeUploads.dryRun, dryRun),
        inArray(schema.youtubeUploads.status, ["QUEUED", "IN_PROGRESS"]),
      ),
    )
    .orderBy(asc(schema.youtubeUploads.createdAt))
    .limit(1);
  return row?.id;
}

/**
 * The oldest Instagram Reel publication of the channel's market, published in the last 30 days,
 * that has no upload of this kind yet (any status: a failed one waits for a person).
 */
export async function nextYouTubeCandidate(
  ctx: ServiceContext,
  dryRun: boolean,
): Promise<{ publicationId: string } | undefined> {
  const app = ctx.youtube.app;
  if (!app) return undefined;
  const p = schema.publications;
  const since = new Date(ctx.clock.now().getTime() - SYNC_MAX_AGE_DAYS * 86_400_000);
  const [row] = await ctx.db
    .select({ publicationId: p.id })
    .from(p)
    .innerJoin(schema.contentVariants, eq(schema.contentVariants.id, p.contentVariantId))
    .innerJoin(schema.markets, eq(schema.markets.id, p.marketId))
    .where(
      and(
        eq(p.status, "PUBLISHED"),
        eq(p.dryRun, false),
        eq(schema.contentVariants.format, "REEL"),
        eq(schema.markets.code, app.marketCode),
        gte(p.publishedAt, since),
        sql`not exists (select 1 from ${schema.youtubeUploads} u where u.content_variant_id = ${p.contentVariantId} and u.dry_run = ${dryRun})`,
      ),
    )
    .orderBy(asc(p.publishedAt))
    .limit(1);
  return row;
}

/** A new upload row for one published Instagram Reel. */
async function createUpload(
  ctx: ServiceContext,
  publicationId: string,
  dryRun: boolean,
): Promise<string> {
  const [publication] = await ctx.db
    .select()
    .from(schema.publications)
    .where(eq(schema.publications.id, publicationId));
  if (!publication) throw new NotFoundError("Publication not found.");
  if (publication.status !== "PUBLISHED" || publication.dryRun) {
    throw new InvalidStateError("Only a Reel that Instagram has published goes to YouTube.");
  }
  const [row] = await ctx.db
    .insert(schema.youtubeUploads)
    .values({
      contentVariantId: publication.contentVariantId,
      contentVariantVersionId: publication.contentVariantVersionId,
      publicationId,
      marketId: publication.marketId,
      dryRun,
      createdBy: ctx.actor.type === "USER" ? ctx.actor.userId : null,
    })
    .returning({ id: schema.youtubeUploads.id });
  if (!row) throw new Error("Insert returned no row.");
  return row.id;
}

/** J25: one Short per run, when YouTube is configured and `youtube.enabled` is on. */
export async function syncYouTubeShorts(ctx: ServiceContext): Promise<SyncYouTubeResult> {
  const mode = ctx.youtube.publishMode;
  if (mode === "off" || !ctx.youtube.app) return { status: "OFF" };
  if (!(await isYouTubeEnabled(ctx))) return { status: "DISABLED" };
  const dryRun = mode === "dry_run_only";
  let uploadId = await openUpload(ctx, dryRun);
  if (!uploadId) {
    const candidate = await nextYouTubeCandidate(ctx, dryRun);
    if (!candidate) return { status: "NOTHING_TO_DO" };
    uploadId = await createUpload(ctx, candidate.publicationId, dryRun);
  }
  return { status: "RAN", uploadId, outcome: await runYouTubeUpload(ctx, { uploadId }) };
}

export const DryRunYouTubeInput = z.object({ publicationId: z.uuid().optional() });

/**
 * A dry run of one published Reel (the CLI): every guard, the token and the channel are checked
 * and the metadata is stored; nothing is uploaded. Needs only a configured channel, not the switch.
 */
export async function dryRunYouTubeUpload(
  ctx: ServiceContext,
  raw: z.input<typeof DryRunYouTubeInput> = {},
): Promise<{ uploadId: string; outcome: YouTubeUploadOutcome }> {
  const input = DryRunYouTubeInput.parse(raw);
  if (ctx.youtube.publishMode === "off" || !ctx.youtube.app) {
    throw new ValidationError(
      "YouTube uploads are off in this environment (YOUTUBE_PUBLISH_MODE).",
    );
  }
  const publicationId =
    input.publicationId ?? (await nextYouTubeCandidate(ctx, true))?.publicationId;
  if (!publicationId) throw new NotFoundError("No published Reel to try.");
  const uploadId = await createUpload(ctx, publicationId, true);
  return { uploadId, outcome: await runYouTubeUpload(ctx, { uploadId }) };
}

/**
 * A new live attempt for a FAILED live upload, after a person has looked at the channel (the
 * cron never does this). Runs at once; needs `live` and the switch like the cron.
 */
export async function retryYouTubeUpload(
  ctx: ServiceContext,
  input: { uploadId: string },
): Promise<{ uploadId: string; outcome: YouTubeUploadOutcome }> {
  const [failed] = await ctx.db
    .select()
    .from(schema.youtubeUploads)
    .where(eq(schema.youtubeUploads.id, input.uploadId));
  if (!failed) throw new NotFoundError("YouTube upload not found.");
  if (failed.status !== "FAILED" || failed.dryRun) {
    throw new InvalidStateError("Only a failed live upload can be retried.");
  }
  const uploadId = await createUpload(ctx, failed.publicationId, false);
  return { uploadId, outcome: await runYouTubeUpload(ctx, { uploadId }) };
}

export type YouTubeUploadRow = {
  id: string;
  publicationId: string;
  status: string;
  dryRun: boolean;
  step: string;
  url: string | null;
  title: string | null;
  lastError: YouTubeError | null;
  createdAt: Date;
};

export type YouTubeStatus = {
  mode: PublishMode;
  enabled: boolean;
  privacyStatus: string;
  /** Not secret: the channel id and market the environment names. */
  channelId: string | null;
  marketCode: string | null;
  nextCandidate: string | null;
  recent: YouTubeUploadRow[];
};

/** What the CLI shows: the switches, the next Reel and the latest uploads. No secret in it. */
export async function getYouTubeStatus(ctx: ServiceContext): Promise<YouTubeStatus> {
  const mode = ctx.youtube.publishMode;
  const rows = await ctx.db
    .select()
    .from(schema.youtubeUploads)
    .orderBy(desc(schema.youtubeUploads.createdAt))
    .limit(10);
  return {
    mode,
    enabled: await isYouTubeEnabled(ctx),
    privacyStatus: await youtubePrivacyStatus(ctx),
    channelId: ctx.youtube.app?.channelId ?? null,
    marketCode: ctx.youtube.app?.marketCode ?? null,
    nextCandidate:
      (await nextYouTubeCandidate(ctx, mode === "dry_run_only"))?.publicationId ?? null,
    recent: rows.map((r) => ({
      id: r.id,
      publicationId: r.publicationId,
      status: r.status,
      dryRun: r.dryRun,
      step: r.step,
      url: r.url,
      title: (r.metadata as YouTubeMetadata | null)?.title ?? null,
      lastError: r.lastError,
      createdAt: r.createdAt,
    })),
  };
}

export function formatYouTubeStatus(status: YouTubeStatus): string {
  const lines = [
    `YouTube Shorts: mode ${status.mode}, switch youtube.enabled ${status.enabled ? "on" : "off"}, privacy ${status.privacyStatus}`,
    `  channel ${status.channelId ?? "(not configured)"}, market ${status.marketCode ?? "-"}`,
    `  next Reel: ${status.nextCandidate ?? "none"}`,
  ];
  for (const r of status.recent) {
    lines.push(
      `  ${r.createdAt.toISOString()} ${r.id} ${r.dryRun ? "dry run" : "live"} ${r.status} (${r.step})${r.url ? ` ${r.url}` : ""}${r.title ? ` "${r.title}"` : ""}${r.lastError ? ` – ${r.lastError.message}` : ""}`,
    );
  }
  return lines.join("\n");
}
