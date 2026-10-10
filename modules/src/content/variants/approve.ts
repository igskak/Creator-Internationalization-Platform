import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import { ApprovedSnapshot } from "@rc/db/json";
import { asc, desc, eq } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { type ServiceContext, withTransaction } from "../../core";
import { getIdeaCards } from "../../knowledge/retrieval";
import { contentOf } from "./content";
import { staleLockError, validateDraftContent } from "./edit";
import { currentRenderState } from "./render-state";
import { approvalBlockers, approvalChecklist, assertTransition } from "./state";
import { transitionVariant } from "./transition";

type Variant = typeof schema.contentVariants.$inferSelect;

// The `approveVariant` action (plan 05 §5.7, 10 §10.4.3 row 9, M4-06): freezes what the reviewer
// saw as an immutable `content_variant_versions` snapshot bound to the exact render.

export const ApproveVariantInput = z.object({
  variantId: z.uuid(),
  lockVersion: z.number().int().nonnegative(),
  checklist: z.object({
    factsChecked: z.boolean(),
    safetyChecked: z.boolean().optional(),
    manychatConfigured: z.boolean().optional(),
  }),
});
export type ApproveVariantInput = z.input<typeof ApproveVariantInput>;

export type ApproveResult = { variant: Variant; versionId: string; versionNo: number };

/** Keys sorted at every level, so equal content always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of a snapshot (`content_variant_versions.content_hash`). */
export const hashSnapshot = (snapshot: ApprovedSnapshot): string =>
  createHash("sha256").update(canonical(snapshot)).digest("hex");

/** What the checklist asks for, as refusal messages for the items not ticked. */
function checkTicked(
  items: ReturnType<typeof approvalChecklist>,
  ticked: z.infer<typeof ApproveVariantInput>["checklist"],
): void {
  const missing = items.filter((item) => ticked[item] !== true);
  if (missing.length > 0) {
    const fieldErrors = Object.fromEntries(
      missing.map((item) => [`checklist.${item}`, ["Tick this box to approve."]]),
    );
    throw new ValidationError("Tick every box of the checklist to approve.", { fieldErrors });
  }
}

/**
 * Approves a READY_FOR_REVIEW variant. The guards (10 §10.4.3 row 9): the lock version is current;
 * the current render is READY and was made from the current content; no blocking flag; a
 * commercial idea has an offer; the draft still passes the blocking checks; every box of the
 * checklist is ticked (facts always; safety with SAFETY_REVIEW; ManyChat with a keyword CTA).
 * Writes the snapshot, points the variant at it, sets APPROVED, and records the review event, in
 * one transaction.
 */
export async function approveVariant(
  ctx: ServiceContext,
  raw: ApproveVariantInput,
): Promise<ApproveResult> {
  const parsed = ApproveVariantInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const input = parsed.data;

  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, input.variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { id: input.variantId } });
  assertTransition(variant.status, "APPROVE");
  if (variant.lockVersion !== input.lockVersion) throw await staleLockError(ctx, variant);
  const content = contentOf(variant);
  if (!content) throw new InvalidStateError("There is no draft to approve yet.");

  const [idea] = await ctx.db
    .select({ commercialIntent: schema.masterIdeas.commercialIntent })
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, variant.masterIdeaId));
  const { state, current } = await currentRenderState(ctx, variant);
  const blockers = approvalBlockers({
    status: variant.status,
    flags: variant.flags,
    render: state,
    hasContent: true,
    commercial: (idea?.commercialIntent ?? "NONE") !== "NONE",
    hasOffer: variant.offerId !== null,
    ctaType: variant.ctaType,
  });
  if (blockers.length > 0 || !current) {
    throw new InvalidStateError("This draft cannot be approved yet.", {
      details: { blockers },
    });
  }
  checkTicked(
    approvalChecklist({ flags: variant.flags, ctaType: variant.ctaType }),
    input.checklist,
  );

  // A last look at the whole draft: a blocking finding that slipped past the flags stops it.
  // A number the cards do not support is already the NUMERIC_MISMATCH flag, checked above.
  const hard = (await validateDraftContent(ctx, variant, content)).filter(
    (issue) => issue.severity === "BLOCKER" && issue.code !== "NUMERIC_MISMATCH",
  );
  if (hard.length > 0) {
    throw new InvalidStateError("The draft no longer passes the checks.", {
      details: { issues: hard.slice(0, 10) },
    });
  }

  const files = await ctx.db
    .select({ key: schema.renderedSlides.storageKey })
    .from(schema.renderedSlides)
    .where(eq(schema.renderedSlides.carouselRenderId, current.id))
    .orderBy(asc(schema.renderedSlides.slideIndex));
  const cards = await getIdeaCards(ctx, variant.masterIdeaId);
  const cited = new Set(content.slides.flatMap((s) => s.knowledgeIds));
  const snapshot: ApprovedSnapshot = ApprovedSnapshot.parse({
    hook: content.hook,
    hookType: variant.hookType ?? "",
    caption: content.caption,
    cta: content.cta,
    hashtags: content.hashtags,
    slides: content.slides,
    visualStyle: variant.visualStyle ?? "",
    templateSequence: variant.templateSequence,
    ...(variant.offerId ? { offerId: variant.offerId } : {}),
    ...(variant.campaignId ? { campaignId: variant.campaignId } : {}),
    ...(variant.utmJson ? { utm: variant.utmJson } : {}),
    renderId: current.id,
    renderedSlideKeys: files.map((f) => f.key),
    knowledge: cards.filter((c) => cited.has(c.id)).map((c) => ({ id: c.id, version: c.version })),
    generationVersion: variant.generationVersion ?? "",
  });

  return withTransaction(ctx, async (tx) => {
    const [locked] = await tx.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variant.id))
      .for("update");
    if (!locked) throw new NotFoundError("Variant not found.");
    if (locked.lockVersion !== input.lockVersion) throw await staleLockError(tx, locked);
    if (locked.currentRenderId !== current.id) {
      throw new InvalidStateError("The carousel was rendered again. Look at it and approve again.");
    }

    const [last] = await tx.db
      .select({ no: schema.contentVariantVersions.versionNo })
      .from(schema.contentVariantVersions)
      .where(eq(schema.contentVariantVersions.contentVariantId, variant.id))
      .orderBy(desc(schema.contentVariantVersions.versionNo))
      .limit(1);
    const versionNo = (last?.no ?? 0) + 1;
    const [version] = await tx.db
      .insert(schema.contentVariantVersions)
      .values({
        contentVariantId: variant.id,
        versionNo,
        snapshot,
        carouselRenderId: current.id,
        contentHash: hashSnapshot(snapshot),
        approvedBy: ctx.actor.type === "USER" ? ctx.actor.userId : unreachableActor(),
        approvedAt: ctx.clock.now(),
      })
      .returning({ id: schema.contentVariantVersions.id });
    if (!version) throw new Error("Insert returned no row.");

    const approved = await transitionVariant(tx, {
      variantId: variant.id,
      event: "APPROVE",
      set: { approvedVersionId: version.id },
      data: { versionId: version.id, versionNo, renderId: current.id },
    });
    await tx.db.insert(schema.reviewEvents).values({
      contentVariantId: variant.id,
      action: "APPROVE",
      editedValue: { versionId: version.id, versionNo },
      reviewerId: ctx.actor.type === "USER" ? ctx.actor.userId : null,
      variantLockVersion: input.lockVersion,
    });
    return { variant: approved, versionId: version.id, versionNo };
  });
}

function unreachableActor(): never {
  throw new InvalidStateError("Only a person can approve a draft.");
}

export type VersionCheck = { ok: boolean; problems: string[] };

/**
 * Checks that an approved version is still what was approved: the stored hash matches its
 * snapshot, its render exists and is READY, and the render's image files are the ones listed in
 * the snapshot, in order. Used by the acceptance check "the snapshot matches the render".
 */
export async function verifyApprovedVersion(
  ctx: ServiceContext,
  versionId: string,
): Promise<VersionCheck> {
  const [version] = await ctx.db
    .select()
    .from(schema.contentVariantVersions)
    .where(eq(schema.contentVariantVersions.id, versionId));
  if (!version) throw new NotFoundError("Version not found.", { details: { versionId } });
  const problems: string[] = [];
  if (hashSnapshot(version.snapshot) !== version.contentHash) {
    problems.push("The stored hash does not match the snapshot.");
  }
  if (version.snapshot.renderId !== version.carouselRenderId) {
    problems.push("The snapshot names another render than the version.");
  }
  const [render] = await ctx.db
    .select()
    .from(schema.carouselRenders)
    .where(eq(schema.carouselRenders.id, version.carouselRenderId));
  if (!render || render.status !== "READY") problems.push("The render is missing or not READY.");
  const files = await ctx.db
    .select({ key: schema.renderedSlides.storageKey })
    .from(schema.renderedSlides)
    .where(eq(schema.renderedSlides.carouselRenderId, version.carouselRenderId))
    .orderBy(asc(schema.renderedSlides.slideIndex));
  if (
    JSON.stringify(files.map((f) => f.key)) !== JSON.stringify(version.snapshot.renderedSlideKeys)
  ) {
    problems.push("The images of the render are not the ones in the snapshot.");
  }
  if (
    render &&
    render.slideCount !== null &&
    render.slideCount !== version.snapshot.slides.length
  ) {
    problems.push("The render has another number of slides than the snapshot.");
  }
  return { ok: problems.length === 0, problems };
}
