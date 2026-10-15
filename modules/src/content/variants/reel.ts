import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import { ApprovedSnapshot } from "@rc/db/json";
import { desc, eq } from "@rc/db/orm";
import { InvalidStateError, NotFoundError } from "@rc/lib/errors";
import { type ServiceContext, withTransaction } from "../../core";
import { getIdeaCards } from "../../knowledge/retrieval";
import { planCampaign } from "../../offers";
import { planReelDisclosure } from "../../visuals";
import type { VersionCheck } from "./approve";
import { staleLockError } from "./edit";
import { approvalBlockers, approvalChecklist, type RenderState } from "./state";
import { transitionVariant } from "./transition";

type Variant = typeof schema.contentVariants.$inferSelect;
type ReelRender = typeof schema.reelRenders.$inferSelect;
type ReelScript = typeof schema.reelScripts.$inferSelect;

// Review of a Reel variant (plan 18 §18.2 step 3, M8-09): its "render" is the assembled video, and
// its approval freezes that exact file (key and SHA-256) and the script it was made from. The rest
// (reject, request changes, un-approve, schedule) is the same state machine as a carousel's.

/** The card text as the viewer reads it: without the `**` accent marks. */
const plain = (card: string) => card.replaceAll("**", "").replace(/\s+/g, " ").trim();

/**
 * Whether the Reel's video shows its newest script: READY when the current render is READY and
 * was assembled from the newest script version, STALE when a newer script has no video yet,
 * RENDERING while the Reel is being made, FAILED when the last assembly failed, NONE before.
 */
export async function reelRenderState(
  ctx: ServiceContext,
  variant: Variant,
): Promise<{ state: RenderState; current: ReelRender | null; script: ReelScript | null }> {
  const [script = null] = await ctx.db
    .select()
    .from(schema.reelScripts)
    .where(eq(schema.reelScripts.contentVariantId, variant.id))
    .orderBy(desc(schema.reelScripts.version))
    .limit(1);
  const [current] = variant.currentReelRenderId
    ? await ctx.db
        .select()
        .from(schema.reelRenders)
        .where(eq(schema.reelRenders.id, variant.currentReelRenderId))
    : [];
  if (variant.status === "GENERATING") return { state: "RENDERING", current: null, script };
  if (!current || current.status !== "READY" || !current.storageKey) {
    const [latest] = await ctx.db
      .select({ status: schema.reelRenders.status })
      .from(schema.reelRenders)
      .where(eq(schema.reelRenders.contentVariantId, variant.id))
      .orderBy(desc(schema.reelRenders.createdAt))
      .limit(1);
    return { state: latest?.status === "FAILED" ? "FAILED" : "NONE", current: null, script };
  }
  return {
    state: script && current.reelScriptId !== script.id ? "STALE" : "READY",
    current,
    script,
  };
}

/** What blocks the approval of a Reel, with the facts the action list needs. */
export async function reelReviewFacts(ctx: ServiceContext, variant: Variant) {
  const [idea] = await ctx.db
    .select({ commercialIntent: schema.masterIdeas.commercialIntent })
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, variant.masterIdeaId));
  const { state, current, script } = await reelRenderState(ctx, variant);
  return {
    facts: {
      status: variant.status,
      flags: variant.flags,
      render: state,
      // A Reel has something to review once it has a script and a caption.
      hasContent: script !== null && variant.caption !== null,
      commercial: (idea?.commercialIntent ?? "NONE") !== "NONE",
      hasOffer: variant.offerId !== null,
      ctaType: variant.ctaType,
    },
    current,
    script,
  };
}

/**
 * Approves a READY_FOR_REVIEW Reel (the REEL branch of `approveVariant`): the same guards as a
 * carousel (lock version, current video, no blocking flag, offer if commercial, the checklist),
 * then an immutable snapshot that names the video file and its hash, the caption, the CTA and the
 * disclosure, in one transaction with the transition and the review event.
 */
export async function approveReelVariant(
  ctx: ServiceContext,
  variant: Variant,
  input: { lockVersion: number },
  check: {
    hashSnapshot: (snapshot: ApprovedSnapshot) => string;
    checkTicked: (items: ReturnType<typeof approvalChecklist>) => void;
  },
): Promise<{ variant: Variant; versionId: string; versionNo: number }> {
  if (variant.lockVersion !== input.lockVersion) throw await staleLockError(ctx, variant);
  const { facts, current, script } = await reelReviewFacts(ctx, variant);
  const blockers = approvalBlockers(facts);
  if (blockers.length > 0 || !current || !script) {
    throw new InvalidStateError("This Reel cannot be approved yet.", { details: { blockers } });
  }
  check.checkTicked(approvalChecklist(facts));
  if (!current.storageKey || !current.sha256 || !current.bytes || !current.durationMs) {
    throw new InvalidStateError("The Reel's video has no file details; make it again.");
  }

  const campaign = facts.commercial ? await planCampaign(ctx, variant) : null;
  const chosen =
    script.hookOptions.find((h) => h.id === script.chosenHookId) ?? script.hookOptions[0];
  // The knowledge behind the Reel: the cards cited by the carousel slides its claims come from.
  const [source] = variant.sourceVariantId
    ? await ctx.db
        .select({ slides: schema.contentVariants.slidesJson })
        .from(schema.contentVariants)
        .where(eq(schema.contentVariants.id, variant.sourceVariantId))
    : [];
  const claimed = new Set([
    ...script.scenes.flatMap((s) => s.claimSlideIds),
    ...(chosen?.claimSlideIds ?? []),
  ]);
  const knowledgeIds = new Set(
    (source?.slides ?? []).filter((s) => claimed.has(s.id)).flatMap((s) => s.knowledgeIds),
  );
  // The idea's cards, as the carousel's approval reads them (the cited ones are kept).
  const cards = knowledgeIds.size ? await getIdeaCards(ctx, variant.masterIdeaId) : [];
  const disclosure = await planReelDisclosure(ctx, { marketId: variant.marketId });
  const snapshot: ApprovedSnapshot = ApprovedSnapshot.parse({
    format: "REEL",
    hook: plain(chosen?.card ?? variant.hook ?? ""),
    hookType: chosen?.hookType ?? variant.hookType ?? "",
    caption: variant.caption ?? "",
    cta: variant.ctaJson ?? { type: variant.ctaType ?? "NONE", text: variant.cta ?? "" },
    hashtags: variant.hashtags,
    slides: [],
    visualStyle: "",
    templateSequence: [],
    ...(variant.offerId ? { offerId: variant.offerId } : {}),
    ...(campaign ? { campaignId: campaign.campaignId, utm: campaign.utm } : {}),
    renderId: current.id,
    renderedSlideKeys: [],
    knowledge: cards
      .filter((c) => knowledgeIds.has(c.id))
      .map((c) => ({ id: c.id, version: c.version })),
    generationVersion: script.promptVersion ?? "",
    ...(disclosure ? { disclosure } : {}),
    reel: {
      renderId: current.id,
      scriptId: script.id,
      scriptVersion: script.version,
      chosenHookId: script.chosenHookId,
      sourceVariantId: variant.sourceVariantId,
      videoKey: current.storageKey,
      sha256: current.sha256,
      bytes: current.bytes,
      durationMs: current.durationMs,
      width: current.width,
      height: current.height,
      audioKind: current.audioKind,
      cards: [...script.scenes].sort((a, b) => a.index - b.index).map((s) => plain(s.card)),
    },
  });

  return withTransaction(ctx, async (tx) => {
    const [locked] = await tx.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variant.id))
      .for("update");
    if (!locked) throw new NotFoundError("Variant not found.");
    if (locked.lockVersion !== input.lockVersion) throw await staleLockError(tx, locked);
    if (locked.currentReelRenderId !== current.id) {
      throw new InvalidStateError("The Reel was made again. Watch it and approve again.");
    }
    const [last] = await tx.db
      .select({ no: schema.contentVariantVersions.versionNo })
      .from(schema.contentVariantVersions)
      .where(eq(schema.contentVariantVersions.contentVariantId, variant.id))
      .orderBy(desc(schema.contentVariantVersions.versionNo))
      .limit(1);
    const versionNo = (last?.no ?? 0) + 1;
    if (ctx.actor.type !== "USER") throw new InvalidStateError("Only a person can approve a Reel.");
    const [version] = await tx.db
      .insert(schema.contentVariantVersions)
      .values({
        contentVariantId: variant.id,
        versionNo,
        snapshot,
        reelRenderId: current.id,
        contentHash: check.hashSnapshot(snapshot),
        approvedBy: ctx.actor.userId,
        approvedAt: ctx.clock.now(),
      })
      .returning({ id: schema.contentVariantVersions.id });
    if (!version) throw new Error("Insert returned no row.");
    const approved = await transitionVariant(tx, {
      variantId: variant.id,
      event: "APPROVE",
      set: {
        approvedVersionId: version.id,
        ...(campaign ? { campaignId: campaign.campaignId, utmJson: campaign.utm } : {}),
      },
      data: {
        versionId: version.id,
        versionNo,
        reelRenderId: current.id,
        format: "REEL",
        ...(campaign ? { campaignId: campaign.campaignId } : {}),
      },
    });
    await tx.db.insert(schema.reviewEvents).values({
      contentVariantId: variant.id,
      action: "APPROVE",
      editedValue: { versionId: version.id, versionNo },
      reviewerId: ctx.actor.userId,
      variantLockVersion: input.lockVersion,
    });
    return { variant: approved, versionId: version.id, versionNo };
  });
}

/**
 * The REEL half of `verifyApprovedVersion`: the snapshot still hashes to its stored hash, names the
 * version's render, the render is READY, and its file is the one approved (same key, size and
 * SHA-256 in the database; the publisher also hashes the bytes in storage).
 */
export async function verifyApprovedReelVersion(
  ctx: ServiceContext,
  version: typeof schema.contentVariantVersions.$inferSelect,
  hashSnapshot: (snapshot: ApprovedSnapshot) => string,
): Promise<VersionCheck> {
  const problems: string[] = [];
  const { snapshot } = version;
  if (hashSnapshot(snapshot) !== version.contentHash) {
    problems.push("The stored hash does not match the snapshot.");
  }
  if (!snapshot.reel || snapshot.renderId !== version.reelRenderId) {
    problems.push("The snapshot names another video than the version.");
  }
  const [render] = version.reelRenderId
    ? await ctx.db
        .select()
        .from(schema.reelRenders)
        .where(eq(schema.reelRenders.id, version.reelRenderId))
    : [];
  if (!render || render.status !== "READY") problems.push("The video is missing or not READY.");
  if (
    render &&
    snapshot.reel &&
    (render.storageKey !== snapshot.reel.videoKey || render.sha256 !== snapshot.reel.sha256)
  ) {
    problems.push("The video file is not the one in the snapshot.");
  }
  return { ok: problems.length === 0, problems };
}

/** SHA-256 of bytes, hex (the publisher compares the stored video with the approved hash). */
export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
