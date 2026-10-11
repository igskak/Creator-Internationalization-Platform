import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import type { ApprovedSnapshot } from "@rc/db/json";
import { asc, eq } from "@rc/db/orm";
import { NotFoundError } from "@rc/lib/errors";
import { verifyApprovedVersion } from "../content";
import type { ServiceContext } from "../core";
import { captionProblems, composeCaption } from "./caption";
import { isPublishingEnabled } from "./settings";

// The safeguards of publishing (plan 09 §9.4.2, [S§11.1], M5-06). They run in the GUARDS step and
// again, in part, right before `media_publish`. A failed guard ends the publication as FAILED with
// no further Graph call: nothing here is retried, because nothing here fixes itself.

export type Publication = typeof schema.publications.$inferSelect;
export type SocialAccount = typeof schema.socialAccounts.$inferSelect;
type Variant = typeof schema.contentVariants.$inferSelect;
type RenderedSlide = typeof schema.renderedSlides.$inferSelect;

export const GUARD_CODES = [
  "MODE_OFF",
  "MODE_DRY_RUN_ONLY",
  "PUBLISHING_OFF",
  "CANCELLED",
  "VARIANT_STATE",
  "VERSION_MISMATCH",
  "VERSION_DAMAGED",
  "SLIDES_INVALID",
  "IMAGE_CHANGED",
  "NO_ACCOUNT",
  "ACCOUNT_NOT_ACTIVE",
  "TOKEN_NOT_VALID",
  "MARKET_MISMATCH",
  "NOT_ALLOWLISTED",
  "ALREADY_PUBLISHED",
  "QUOTA_EXHAUSTED",
  "CAPTION_INVALID",
] as const;
export type GuardCode = (typeof GUARD_CODES)[number];

export class GuardFailure extends Error {
  constructor(
    readonly code: GuardCode,
    message: string,
  ) {
    super(message);
    this.name = "GuardFailure";
  }
}

const refuse = (code: GuardCode, message: string): never => {
  throw new GuardFailure(code, message);
};

/** Everything the guards and the machine read, loaded once per step. */
export type PublishContext = {
  publication: Publication;
  variant: Variant;
  version: typeof schema.contentVariantVersions.$inferSelect;
  snapshot: ApprovedSnapshot;
  slides: RenderedSlide[];
  account: SocialAccount | null;
  caption: string;
};

export async function loadPublishContext(
  ctx: ServiceContext,
  publicationId: string,
): Promise<PublishContext> {
  const [publication] = await ctx.db
    .select()
    .from(schema.publications)
    .where(eq(schema.publications.id, publicationId));
  if (!publication)
    throw new NotFoundError("Publication not found.", { details: { publicationId } });
  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, publication.contentVariantId));
  const [version] = await ctx.db
    .select()
    .from(schema.contentVariantVersions)
    .where(eq(schema.contentVariantVersions.id, publication.contentVariantVersionId));
  if (!variant || !version) throw new NotFoundError("The post's variant or version is missing.");
  const slides = await ctx.db
    .select()
    .from(schema.renderedSlides)
    .where(eq(schema.renderedSlides.carouselRenderId, version.carouselRenderId))
    .orderBy(asc(schema.renderedSlides.slideIndex));
  let account: SocialAccount | null = null;
  if (publication.socialAccountId) {
    [account = null] = await ctx.db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, publication.socialAccountId));
  }
  return {
    publication,
    variant,
    version,
    snapshot: version.snapshot,
    slides,
    account,
    caption: composeCaption(version.snapshot),
  };
}

const LIVE_VARIANT_STATUSES: readonly Variant["status"][] = ["SCHEDULED", "PUBLISHING"];
const DRY_RUN_VARIANT_STATUSES: readonly Variant["status"][] = [
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "FAILED",
];

/** Mode of the environment and the kill switch. A dry run needs only that publishing is not `off`. */
export async function checkSwitches(ctx: ServiceContext, dryRun: boolean): Promise<void> {
  const mode = ctx.instagram.publishMode;
  if (mode === "off") {
    refuse(
      "MODE_OFF",
      "Publishing is switched off in this environment (INSTAGRAM_PUBLISH_MODE=off).",
    );
  }
  if (dryRun) return;
  if (mode === "dry_run_only") {
    refuse(
      "MODE_DRY_RUN_ONLY",
      "This environment only allows dry runs (INSTAGRAM_PUBLISH_MODE=dry_run_only): nothing goes live here.",
    );
  }
  if (!(await isPublishingEnabled(ctx))) {
    refuse(
      "PUBLISHING_OFF",
      "Publishing is switched off (the kill switch). Switch it on to publish.",
    );
  }
}

/** The state of the post, its variant, its version and the account: cheap, no network. */
export async function checkState(ctx: ServiceContext, pc: PublishContext): Promise<SocialAccount> {
  const { publication, variant, account } = pc;
  if (publication.status === "CANCELLED") refuse("CANCELLED", "The post was cancelled.");
  const allowed = publication.dryRun ? DRY_RUN_VARIANT_STATUSES : LIVE_VARIANT_STATUSES;
  if (!allowed.includes(variant.status)) {
    refuse("VARIANT_STATE", `The draft is ${variant.status}, so it cannot be published.`);
  }
  // Only APPROVED content goes out: the publication must point at the version the variant holds now.
  if (publication.contentVariantVersionId !== variant.approvedVersionId) {
    refuse("VERSION_MISMATCH", "The draft was changed or un-approved after this post was planned.");
  }
  if (publication.marketId !== variant.marketId) {
    refuse("MARKET_MISMATCH", "The post and its draft belong to different markets.");
  }
  if (publication.instagramMediaId && !publication.dryRun) {
    refuse("ALREADY_PUBLISHED", "This post has already been published.");
  }
  if (!account) refuse("NO_ACCOUNT", "This market has no connected Instagram account.");
  const acct = account as SocialAccount;
  if (acct.marketId !== variant.marketId) {
    refuse(
      "MARKET_MISMATCH",
      "The Instagram account belongs to another market: nothing is posted there.",
    );
  }
  if (acct.status !== "ACTIVE") {
    refuse(
      "ACCOUNT_NOT_ACTIVE",
      `The Instagram account is ${acct.status}: reconnect it in Settings.`,
    );
  }
  if (
    acct.tokenStatus === "INVALID" ||
    acct.tokenStatus === "REVOKED" ||
    (acct.tokenExpiresAt && acct.tokenExpiresAt <= ctx.clock.now())
  ) {
    refuse("TOKEN_NOT_VALID", "The Instagram token is no longer valid: reconnect the account.");
  }
  const allowlist = ctx.instagram.app?.accountAllowlist ?? [];
  if (!allowlist.includes(acct.instagramAccountId)) {
    refuse(
      "NOT_ALLOWLISTED",
      "This Instagram account is not on this environment's allowlist (INSTAGRAM_ACCOUNT_ALLOWLIST).",
    );
  }
  return acct;
}

const MIN_SLIDES = 2;
const MAX_SLIDES = 10;
const SLIDE_WIDTH = 1080;
const SLIDE_HEIGHT = 1350;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * The approved version and its images: intact (hash, render, file list), 2–10 slides of 1080×1350,
 * and each stored file is the one that was rendered (its SHA-256 matches `rendered_slides`).
 */
export async function checkMedia(ctx: ServiceContext, pc: PublishContext): Promise<void> {
  const check = await verifyApprovedVersion(ctx, pc.version.id);
  if (!check.ok) {
    refuse(
      "VERSION_DAMAGED",
      `The approved version does not match its images: ${check.problems.join(" ")}`,
    );
  }
  const { slides } = pc;
  if (slides.length < MIN_SLIDES || slides.length > MAX_SLIDES) {
    refuse(
      "SLIDES_INVALID",
      `A carousel needs ${MIN_SLIDES} to ${MAX_SLIDES} slides, this one has ${slides.length}.`,
    );
  }
  for (const slide of slides) {
    if (slide.width !== SLIDE_WIDTH || slide.height !== SLIDE_HEIGHT) {
      refuse(
        "SLIDES_INVALID",
        `Slide ${slide.slideIndex + 1} is ${slide.width}×${slide.height}, it must be ${SLIDE_WIDTH}×${SLIDE_HEIGHT}.`,
      );
    }
    const info = await ctx.storage.head(slide.storageKey);
    if (!info)
      refuse(
        "IMAGE_CHANGED",
        `The image of slide ${slide.slideIndex + 1} is missing from storage.`,
      );
    if ((info?.size ?? 0) > MAX_IMAGE_BYTES) {
      refuse("SLIDES_INVALID", `Slide ${slide.slideIndex + 1} is larger than 8 MB.`);
    }
    const digest = createHash("sha256")
      .update(await ctx.storage.getBytes(slide.storageKey))
      .digest("hex");
    if (digest !== slide.sha256) {
      refuse(
        "IMAGE_CHANGED",
        `The image of slide ${slide.slideIndex + 1} is not the one that was rendered and approved.`,
      );
    }
  }
}

/** Caption and hashtags against Meta's limits (V-05). */
export function checkCaption(pc: PublishContext): void {
  const problems = captionProblems(pc.caption);
  if (problems.length > 0) refuse("CAPTION_INVALID", problems.join(" "));
}

/** The publishing allowance left (V-06): checked against a fresh number from Instagram. */
export function checkQuota(quota: { used: number; total: number } | undefined): void {
  if (quota && quota.used >= quota.total) {
    refuse(
      "QUOTA_EXHAUSTED",
      `Instagram's limit of ${quota.total} API posts in 24 hours is used up. Try again later.`,
    );
  }
}

/** The full set of guards before any Graph call (the GUARDS step). */
export async function checkAllGuards(ctx: ServiceContext, pc: PublishContext): Promise<void> {
  await checkSwitches(ctx, pc.publication.dryRun);
  await checkState(ctx, pc);
  await checkMedia(ctx, pc);
  checkCaption(pc);
}
