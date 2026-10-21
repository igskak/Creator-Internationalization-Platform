import { schema } from "@rc/db";
import type { MarketBrief } from "@rc/db/json";
import { and, asc, desc, eq, sql } from "@rc/db/orm";
import { NotFoundError } from "@rc/lib/errors";
import { PRESIGN_TTL } from "@rc/lib/providers/storage";
import { z } from "zod";
import type { ServiceContext } from "../../core";
import { num } from "./range";
import {
  isEarlySnapshot,
  pickShown,
  type ReelWatch,
  reelWatch,
  type SnapshotRates,
  snapshotRates,
} from "./reels";

// The lineage of one post (plan 04 §4.6, 05 §5.10 `getLineage`, M6-09): from the source and the
// cards through the idea, the market adaptation and the approved version to the publication and
// its numbers, with the review history and what the model runs cost. Read-only, and everything is
// plain data for the screen.

export const GetLineageInput = z.object({ publicationId: z.uuid() });

export type LineageSnapshot = {
  slot: string;
  measuredAt: Date;
  ageHours: number;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  totalInteractions: number | null;
  saveRate: number | null;
  shareRate: number | null;
};

export type Lineage = {
  publication: {
    id: string;
    status: string;
    publishedAt: Date | null;
    permalink: string | null;
    instagramMediaId: string | null;
    followerCountAtPublish: number | null;
    accountUsername: string | null;
  };
  market: { id: string; code: string; name: string; flagEmoji: string | null; timeZone: string };
  variant: {
    id: string;
    format: string;
    status: string;
    hook: string | null;
    hookType: string | null;
    visualStyle: string | null;
    ctaType: string | null;
    templateSequence: string[];
    campaignId: string | null;
    offerName: string | null;
    generationVersion: string | null;
    /** A Reel: the carousel it was made from. */
    sourceVariantId: string | null;
    /** A carousel: the Reel made from it, if any. */
    reels: { variantId: string; status: string }[];
  };
  idea: {
    id: string;
    topic: string;
    category: string;
    angle: string;
    coreMessage: string;
    evidenceSummary: string | null;
    commercialIntent: string;
  };
  cards: {
    id: string;
    version: number;
    role: string;
    title: string;
    claim: string;
    sourceTitle: string | null;
    sourcePage: number | null;
    quote: string | null;
  }[];
  brief: Pick<
    MarketBrief,
    "audienceFraming" | "tone" | "hookType" | "risks" | "culturalHooks" | "differentiationNotes"
  > | null;
  version: {
    id: string;
    versionNo: number;
    approvedAt: Date;
    approvedBy: string | null;
    caption: string;
    cta: { type: string; text: string };
    hashtags: string[];
    slideCount: number;
    /** Presigned links to the approved slides (a carousel), in order. */
    slideUrls: string[];
    /** Presigned link to the approved video (a Reel). */
    videoUrl: string | null;
    disclosure: string | null;
  };
  reviewHistory: {
    action: string;
    at: Date;
    reviewer: string | null;
    reasonCode: string | null;
    reason: string | null;
    field: string | null;
  }[];
  generation: {
    runs: number;
    costUsd: number | null;
    byStage: { stage: string; runs: number; costUsd: number | null }[];
  };
  metrics: {
    /**
     * The snapshot the numbers are shown from (`pickShown`): D7, else the closest at least 72 h old,
     * else, while the post is younger, the newest one (`early`); null before the first snapshot.
     */
    shown:
      | (LineageSnapshot &
          SnapshotRates & {
            isExactD7: boolean;
            /** Younger than 72 h: H2, D1 or a manual snapshot, not yet the D7 numbers. */
            early: boolean;
          })
      | null;
    timeline: LineageSnapshot[];
    /** A Reel: what its watch metrics say at the shown snapshot (M8-10); null for a carousel. */
    watch: ReelWatch | null;
  };
};

export async function getLineage(
  ctx: ServiceContext,
  raw: z.input<typeof GetLineageInput>,
): Promise<Lineage> {
  const { publicationId } = GetLineageInput.parse(raw);
  const p = schema.publications;
  const [head] = await ctx.db
    .select({
      publication: p,
      variant: schema.contentVariants,
      version: schema.contentVariantVersions,
      market: schema.markets,
      idea: schema.masterIdeas,
      offerName: schema.offers.name,
      approvedBy: schema.appUsers.displayName,
      approvedByEmail: schema.appUsers.email,
      accountUsername: schema.socialAccounts.username,
    })
    .from(p)
    .innerJoin(schema.contentVariants, eq(schema.contentVariants.id, p.contentVariantId))
    .innerJoin(
      schema.contentVariantVersions,
      eq(schema.contentVariantVersions.id, p.contentVariantVersionId),
    )
    .innerJoin(schema.markets, eq(schema.markets.id, schema.contentVariants.marketId))
    .innerJoin(schema.masterIdeas, eq(schema.masterIdeas.id, schema.contentVariants.masterIdeaId))
    .innerJoin(schema.appUsers, eq(schema.appUsers.id, schema.contentVariantVersions.approvedBy))
    .leftJoin(schema.offers, eq(schema.offers.id, schema.contentVariants.offerId))
    .leftJoin(schema.socialAccounts, eq(schema.socialAccounts.id, p.socialAccountId))
    .where(and(eq(p.id, publicationId), eq(p.dryRun, false)));
  if (!head) throw new NotFoundError("Post not found.", { details: { publicationId } });
  const { publication, variant, version, market, idea } = head;

  const cards = await ctx.db
    .select({
      id: schema.knowledgeItems.id,
      version: schema.masterIdeaKnowledge.knowledgeVersion,
      role: schema.masterIdeaKnowledge.role,
      title: schema.knowledgeItems.title,
      claim: schema.knowledgeItems.claim,
      sourceTitle: schema.sourceAssets.title,
      reference: schema.knowledgeItems.sourceReference,
    })
    .from(schema.masterIdeaKnowledge)
    .innerJoin(
      schema.knowledgeItems,
      eq(schema.knowledgeItems.id, schema.masterIdeaKnowledge.knowledgeItemId),
    )
    .leftJoin(schema.sourceAssets, eq(schema.sourceAssets.id, schema.knowledgeItems.sourceAssetId))
    .where(eq(schema.masterIdeaKnowledge.masterIdeaId, idea.id))
    .orderBy(asc(schema.masterIdeaKnowledge.role), asc(schema.knowledgeItems.title));

  const snapshots = await ctx.db
    .select()
    .from(schema.metricSnapshots)
    .where(eq(schema.metricSnapshots.publicationId, publicationId))
    .orderBy(asc(schema.metricSnapshots.mediaAgeHours), asc(schema.metricSnapshots.measuredAt));
  const rate = (value: number | null, reach: number | null) =>
    value === null || reach === null || reach === 0 ? null : value / reach;
  const timeline: LineageSnapshot[] = snapshots.map((s) => ({
    slot: s.snapshotSlot,
    measuredAt: s.measuredAt,
    ageHours: num(s.mediaAgeHours) ?? 0,
    reach: s.reach,
    views: s.views,
    likes: s.likes,
    comments: s.comments,
    saves: s.saves,
    shares: s.shares,
    totalInteractions: s.totalInteractions,
    saveRate: rate(s.saves, s.reach),
    shareRate: rate(s.shares, s.reach),
  }));
  const shown = pickShown(snapshots);
  const [reelRender] = version.reelRenderId
    ? await ctx.db
        .select({ durationMs: schema.reelRenders.durationMs })
        .from(schema.reelRenders)
        .where(eq(schema.reelRenders.id, version.reelRenderId))
    : [];
  const reelDurationMs = reelRender?.durationMs ?? null;

  const review = await ctx.db
    .select({
      action: schema.reviewEvents.action,
      at: schema.reviewEvents.createdAt,
      reviewerName: schema.appUsers.displayName,
      reviewerEmail: schema.appUsers.email,
      reasonCode: schema.reviewEvents.reasonCode,
      reason: schema.reviewEvents.reason,
      field: schema.reviewEvents.field,
    })
    .from(schema.reviewEvents)
    .leftJoin(schema.appUsers, eq(schema.appUsers.id, schema.reviewEvents.reviewerId))
    .where(eq(schema.reviewEvents.contentVariantId, variant.id))
    .orderBy(asc(schema.reviewEvents.createdAt), asc(schema.reviewEvents.id));

  const runs = await ctx.db
    .select({
      stage: schema.generationRuns.stage,
      runs: sql<number>`count(*)::int`,
      cost: sql<string | null>`sum(${schema.generationRuns.costUsd})`,
    })
    .from(schema.generationRuns)
    .where(eq(schema.generationRuns.contentVariantId, variant.id))
    .groupBy(schema.generationRuns.stage);
  const totalCost = runs.some((r) => r.cost !== null)
    ? runs.reduce((sum, r) => sum + (num(r.cost) ?? 0), 0)
    : null;

  const related =
    variant.format === "CAROUSEL"
      ? await ctx.db
          .select({ id: schema.contentVariants.id, status: schema.contentVariants.status })
          .from(schema.contentVariants)
          .where(
            and(
              eq(schema.contentVariants.sourceVariantId, variant.id),
              eq(schema.contentVariants.format, "REEL"),
            ),
          )
          .orderBy(desc(schema.contentVariants.createdAt))
      : [];

  const presign = async (key: string | undefined) => {
    if (!key) return null;
    try {
      return (await ctx.storage.presignGet(key, { expiresInSeconds: PRESIGN_TTL.preview })).url;
    } catch {
      return null;
    }
  };
  const snapshot = version.snapshot;
  const slideUrls = (
    await Promise.all(snapshot.renderedSlideKeys.slice(0, 10).map((k) => presign(k)))
  ).flatMap((u) => (u ? [u] : []));
  const brief = variant.marketBriefJson;
  const disclosure = snapshot.disclosure;

  return {
    publication: {
      id: publication.id,
      status: publication.status,
      publishedAt: publication.publishedAt,
      permalink: publication.permalink,
      instagramMediaId: publication.instagramMediaId,
      followerCountAtPublish: publication.followerCountAtPublish,
      accountUsername: head.accountUsername,
    },
    market: {
      id: market.id,
      code: market.code,
      name: market.displayName,
      flagEmoji: market.flagEmoji,
      timeZone: market.timezone,
    },
    variant: {
      id: variant.id,
      format: variant.format,
      status: variant.status,
      hook: variant.hook,
      hookType: variant.hookType,
      visualStyle: variant.visualStyle,
      ctaType: variant.ctaType,
      templateSequence: variant.templateSequence,
      campaignId: variant.campaignId,
      offerName: head.offerName,
      generationVersion: variant.generationVersion,
      sourceVariantId: variant.sourceVariantId,
      reels: related.map((r) => ({ variantId: r.id, status: r.status })),
    },
    idea: {
      id: idea.id,
      topic: idea.topic,
      category: idea.category,
      angle: idea.angle,
      coreMessage: idea.coreMessage,
      evidenceSummary: idea.evidenceSummary,
      commercialIntent: idea.commercialIntent,
    },
    cards: cards.map((c) => ({
      id: c.id,
      version: c.version,
      role: c.role,
      title: c.title,
      claim: c.claim,
      sourceTitle: c.sourceTitle,
      sourcePage: c.reference?.pageStart ?? null,
      quote: c.reference?.quote ?? null,
    })),
    brief: brief
      ? {
          audienceFraming: brief.audienceFraming,
          tone: brief.tone,
          hookType: brief.hookType,
          risks: brief.risks,
          culturalHooks: brief.culturalHooks,
          differentiationNotes: brief.differentiationNotes,
        }
      : null,
    version: {
      id: version.id,
      versionNo: version.versionNo,
      approvedAt: version.approvedAt,
      approvedBy: head.approvedBy ?? head.approvedByEmail,
      caption: snapshot.caption,
      cta: { type: snapshot.cta.type, text: snapshot.cta.text },
      hashtags: snapshot.hashtags,
      slideCount: snapshot.slides.length,
      slideUrls,
      videoUrl: await presign(snapshot.reel?.videoKey),
      disclosure: disclosure ? disclosure.mode : null,
    },
    reviewHistory: review.map((e) => ({
      action: e.action,
      at: e.at,
      reviewer: e.reviewerName ?? e.reviewerEmail ?? null,
      reasonCode: e.reasonCode,
      reason: e.reason,
      field: e.field,
    })),
    generation: {
      runs: runs.reduce((sum, r) => sum + Number(r.runs), 0),
      costUsd: totalCost === null ? null : Math.round(totalCost * 10_000) / 10_000,
      byStage: runs
        .map((r) => ({ stage: r.stage, runs: Number(r.runs), costUsd: num(r.cost) }))
        .sort((a, b) => a.stage.localeCompare(b.stage)),
    },
    metrics: {
      shown: shown
        ? {
            slot: shown.snapshotSlot,
            measuredAt: shown.measuredAt,
            ageHours: num(shown.mediaAgeHours) ?? 0,
            reach: shown.reach,
            views: shown.views,
            likes: shown.likes,
            comments: shown.comments,
            saves: shown.saves,
            shares: shown.shares,
            totalInteractions: shown.totalInteractions,
            ...snapshotRates(shown),
            isExactD7: shown.snapshotSlot === "D7",
            early: isEarlySnapshot(shown),
          }
        : null,
      timeline,
      watch: variant.format === "REEL" ? reelWatch(shown?.videoMetricsJson, reelDurationMs) : null,
    },
  };
}
