import { schema } from "@rc/db";
import { and, asc, desc, eq, inArray } from "@rc/db/orm";
import { InvalidStateError, NotFoundError } from "@rc/lib/errors";
import type { reelDirector } from "@rc/prompts";
import { stripEmphasis } from "@rc/templates";
import type { ServiceContext } from "../../core";
import type { NumberLocale } from "../../localization";

// What a Reel is made from (plan 18 §18.2): the approved carousel of one market, its pictures and
// the market's brief. `loadReelSource` checks the carousel may be turned into a Reel and builds the
// director's input from it.

type Variant = typeof schema.contentVariants.$inferSelect;
type Market = typeof schema.markets.$inferSelect;

/** A carousel that is finished (or further): not a draft in the making, not a rejected one. */
export const REEL_SOURCE_STATUSES: readonly Variant["status"][] = [
  "READY_FOR_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
];

export type ReelPicture = {
  assetId: string;
  slideId: string;
  description: string;
  storageKey: string;
};

export type ReelSource = {
  carousel: Variant;
  idea: { id: string; brandId: string };
  market: Market;
  locale: NumberLocale;
  pictures: ReelPicture[];
  directorInput: reelDirector.ReelDirectorInputV2;
};

export const numberLocaleOf = (language: string): NumberLocale =>
  language === "es" ? "es-ES" : language === "ru" ? "ru" : "en";

const RECENT_HOOKS = 5;
/** Posts whose asks and hashtags the Reel's post should not repeat. */
const RECENT_POSTS = 8;
/** The asks a Reel chooses from (reel-director@2): reach first, then the save. */
const REEL_CTA_TYPES = ["SHARE", "FOLLOW", "SAVE"];
/** Carousel asks the Reel keeps as they are: tied to a keyword, an offer or a link. */
const KEPT_CTA_TYPES = new Set(["COMMENT_KEYWORD", "DM_KEYWORD", "LINK_IN_BIO"]);
const LATER_STATUSES: Variant["status"][] = ["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED"];

export async function loadReelSource(
  ctx: ServiceContext,
  carouselVariantId: string,
): Promise<ReelSource> {
  const [carousel] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, carouselVariantId));
  if (!carousel)
    throw new NotFoundError("Variant not found.", { details: { variantId: carouselVariantId } });
  if (carousel.format !== "CAROUSEL") {
    throw new InvalidStateError("A Reel is made from a carousel.", {
      details: { variantId: carouselVariantId, format: carousel.format },
    });
  }
  if (!REEL_SOURCE_STATUSES.includes(carousel.status)) {
    throw new InvalidStateError(`A ${carousel.status} carousel cannot become a Reel.`, {
      details: {
        variantId: carouselVariantId,
        status: carousel.status,
        code: "carousel_not_ready",
      },
    });
  }
  const [idea] = await ctx.db
    .select({ id: schema.masterIdeas.id, brandId: schema.masterIdeas.brandId })
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, carousel.masterIdeaId));
  const [market] = await ctx.db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, carousel.marketId));
  if (!idea || !market)
    throw new NotFoundError("The idea or the market of the carousel is missing.");

  // Pictures: the READY assets the carousel's slides use, once each, in slide order.
  const slides = [...carousel.slidesJson].sort((a, b) => a.index - b.index);
  const assetIds = [
    ...new Set(
      slides.flatMap((s) => Object.values(s.images).flatMap((i) => (i.assetId ? [i.assetId] : []))),
    ),
  ];
  const rows = assetIds.length
    ? await ctx.db
        .select()
        .from(schema.visualAssets)
        .where(inArray(schema.visualAssets.id, assetIds))
    : [];
  const byId = new Map(
    rows.filter((r) => r.status === "READY" && r.storageKey).map((r) => [r.id, r]),
  );
  const pictures: ReelPicture[] = [];
  for (const slide of slides) {
    for (const image of Object.values(slide.images)) {
      const asset = image.assetId ? byId.get(image.assetId) : undefined;
      if (!asset || pictures.some((p) => p.assetId === asset.id)) continue;
      pictures.push({
        assetId: asset.id,
        slideId: slide.id,
        description:
          asset.description ?? asset.prompt ?? slide.altText ?? `Picture of the slide ${slide.id}`,
        storageKey: asset.storageKey ?? "",
      });
    }
  }
  if (pictures.length === 0) {
    throw new InvalidStateError("The carousel has no pictures to make shots from.", {
      details: { variantId: carouselVariantId, code: "no_pictures" },
    });
  }

  const hookTypes = await ctx.db
    .select({ code: schema.taxonomyTerms.code, label: schema.taxonomyTerms.label })
    .from(schema.taxonomyTerms)
    .where(and(eq(schema.taxonomyTerms.kind, "hook_type"), eq(schema.taxonomyTerms.isActive, true)))
    .orderBy(asc(schema.taxonomyTerms.sortOrder), asc(schema.taxonomyTerms.code));
  if (hookTypes.length === 0) throw new InvalidStateError("The taxonomy has no hook types.");

  // The hook types of this market's latest Reels, newest first, so the options do not repeat them.
  const recent = await ctx.db
    .select({
      hookOptions: schema.reelScripts.hookOptions,
      chosenHookId: schema.reelScripts.chosenHookId,
    })
    .from(schema.reelScripts)
    .innerJoin(
      schema.contentVariants,
      eq(schema.contentVariants.id, schema.reelScripts.contentVariantId),
    )
    .where(
      and(
        eq(schema.contentVariants.marketId, market.id),
        eq(schema.contentVariants.format, "REEL"),
      ),
    )
    .orderBy(desc(schema.reelScripts.createdAt))
    .limit(RECENT_HOOKS);
  const recentHookTypes = recent.flatMap((r) => {
    const chosen = r.hookOptions.find((h) => h.id === r.chosenHookId);
    return chosen ? [chosen.hookType] : [];
  });

  // The asks and hashtags of the market's latest approved or posted variants, newest first.
  const latest = await ctx.db
    .select({ ctaType: schema.contentVariants.ctaType, hashtags: schema.contentVariants.hashtags })
    .from(schema.contentVariants)
    .where(
      and(
        eq(schema.contentVariants.marketId, market.id),
        inArray(schema.contentVariants.status, LATER_STATUSES),
      ),
    )
    .orderBy(desc(schema.contentVariants.updatedAt))
    .limit(RECENT_POSTS);
  const recentCtaTypes = latest.flatMap((v) => (v.ctaType ? [v.ctaType] : []));
  const tagCounts = new Map<string, number>();
  for (const tag of [...latest.flatMap((v) => v.hashtags), ...carousel.hashtags]) {
    const key = tag.toLowerCase();
    tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
  }
  const recentHashtags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);

  const ctaTerms = await ctx.db
    .select({ code: schema.taxonomyTerms.code, label: schema.taxonomyTerms.label })
    .from(schema.taxonomyTerms)
    .where(and(eq(schema.taxonomyTerms.kind, "cta_type"), eq(schema.taxonomyTerms.isActive, true)));
  const labelOf = (code: string) => ctaTerms.find((t) => t.code === code)?.label ?? code;
  const carouselCta = carousel.ctaJson ?? {
    type: carousel.ctaType ?? "SAVE",
    text: carousel.cta ?? "",
  };
  const keepsCta = KEPT_CTA_TYPES.has(carouselCta.type) || carouselCta.keyword !== undefined;
  const ctaTypes = (keepsCta ? [carouselCta.type] : REEL_CTA_TYPES).map((code) => ({
    code,
    label: labelOf(code),
  }));

  const brief = carousel.marketBriefJson;
  const codes = new Set(hookTypes.map((t) => t.code));
  const carouselHookType = [carousel.hookType, brief?.hookType].find((c) => c && codes.has(c));
  const directorInput: reelDirector.ReelDirectorInputV2 = {
    market: { code: market.code, displayName: market.displayName, language: market.language },
    carousel: {
      caption: carousel.caption ?? "",
      cta: {
        type: carouselCta.type,
        text: carouselCta.text,
        ...(carouselCta.keyword ? { keyword: carouselCta.keyword } : {}),
      },
      hook: carousel.hook ?? "",
      hookType: carouselHookType ?? hookTypes[0]?.code ?? "",
      slides: slides.map((s) => ({
        id: s.id,
        role: s.role,
        text: Object.values(s.slots).map(stripEmphasis).join(" / "),
        factual: s.factual,
        knowledgeIds: s.knowledgeIds,
      })),
    },
    pictures: pictures.map((p) => ({
      id: p.assetId,
      slideId: p.slideId,
      description: p.description,
    })),
    brief: {
      tone: brief?.tone ?? market.toneNotes,
      terminology: (brief?.terminology ?? []).map((t) => ({
        concept: t.concept,
        localTerm: t.localTerm,
      })),
      ctaType: carousel.ctaType ?? "SAVE",
    },
    taxonomy: { hookTypes },
    recentHookTypes,
    ctaTypes,
    recentCtaTypes,
    recentHashtags,
  };
  return {
    carousel,
    idea,
    market,
    locale: numberLocaleOf(market.language),
    pictures,
    directorInput,
  };
}
