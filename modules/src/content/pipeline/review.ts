import { schema } from "@rc/db";
import type {
  CriticReport,
  CtaSpec,
  DifferentiationReport,
  GenerationConfig,
  MarketBrief,
  QaReport,
  Slide,
  VisualBrief,
} from "@rc/db/json";
import { asc, desc, eq, sql } from "@rc/db/orm";
import { PRESIGN_TTL } from "@rc/lib/providers/storage";
import { registry } from "@rc/templates";
import type { ServiceContext } from "../../core";
import { loadRenderInput } from "../../visuals";
import { getIdeaDetail, type IdeaDetail } from "../ideas";

// What the review screen reads (plan 05 §5.7 `getReviewBundle`, 10 §10.3; read-only in M2-15):
// the idea with the approved text of its cards, and every market's variant with its critic report,
// flags and comparison with the others. Editing and approving come with M4.

/**
 * The rendered carousel of a variant (plan 08 §8.5): READY when the current render matches the
 * content, STALE when the content changed since (a new render is due), RENDERING while one runs,
 * FAILED when the last one failed, NONE before any render.
 */
export type RenderView = {
  state: "NONE" | "RENDERING" | "READY" | "STALE" | "FAILED";
  renderId: string | null;
  /** Presigned URLs of the JPEGs of the current render, in slide order. */
  slides: { index: number; slideId: string; url: string }[];
  qa: QaReport | null;
  error: string | null;
};

export type VariantView = {
  id: string;
  marketCode: string;
  marketName: string;
  flagEmoji: string | null;
  status: (typeof schema.contentVariants.$inferSelect)["status"];
  /** 1–5, null while there is no review. */
  qualityScore: number | null;
  flags: string[];
  hook: string | null;
  hookType: string | null;
  caption: string | null;
  cta: CtaSpec | null;
  hashtags: string[];
  slides: Slide[];
  brief: MarketBrief | null;
  visualBrief: VisualBrief | null;
  render: RenderView;
  critic: CriticReport | null;
  differentiation: DifferentiationReport | null;
  offer: { name: string; type: string } | null;
  generationVersion: string | null;
  generationConfig: GenerationConfig | null;
  lastError: { code: string; message: string } | null;
  /** Generated content exists (a failed or queued variant has none yet). */
  hasContent: boolean;
  lockVersion: number;
  updatedAt: Date;
};

export type ReviewBundle = {
  idea: IdeaDetail;
  variants: VariantView[];
  /** Model cost of the idea's pipeline runs; null when no run is priced. */
  costUsd: number | null;
};

/** Slots in the order of the template (jsonb does not keep the order of keys). */
function inTemplateOrder(slide: Slide): Slide {
  const order = Object.keys(registry.get(slide.templateId)?.textSlots ?? {});
  const known = order.filter((name) => name in slide.slots);
  const rest = Object.keys(slide.slots).filter((name) => !order.includes(name));
  return {
    ...slide,
    slots: Object.fromEntries(
      [...known, ...rest].map((name) => [name, slide.slots[name] as string]),
    ),
  };
}

async function renderView(
  ctx: ServiceContext,
  v: typeof schema.contentVariants.$inferSelect,
): Promise<RenderView> {
  const none: RenderView = { state: "NONE", renderId: null, slides: [], qa: null, error: null };
  if (v.slidesJson.length === 0) return none;
  const [latest] = await ctx.db
    .select()
    .from(schema.carouselRenders)
    .where(eq(schema.carouselRenders.contentVariantId, v.id))
    .orderBy(desc(schema.carouselRenders.createdAt))
    .limit(1);
  const [current] = v.currentRenderId
    ? await ctx.db
        .select()
        .from(schema.carouselRenders)
        .where(eq(schema.carouselRenders.id, v.currentRenderId))
    : [];

  const files = current
    ? await ctx.db
        .select()
        .from(schema.renderedSlides)
        .where(eq(schema.renderedSlides.carouselRenderId, current.id))
        .orderBy(asc(schema.renderedSlides.slideIndex))
    : [];
  const slides = await Promise.all(
    files.map(async (f) => ({
      index: f.slideIndex,
      slideId: f.slideId,
      url: (await ctx.storage.presignGet(f.storageKey, { expiresInSeconds: PRESIGN_TTL.preview }))
        .url,
    })),
  );

  const inFlight = latest && ["PENDING", "RENDERING"].includes(latest.status);
  if (!current || current.status !== "READY") {
    if (inFlight) return { ...none, state: "RENDERING" };
    if (latest?.status === "FAILED") {
      return {
        ...none,
        state: "FAILED",
        qa: latest.qaReport,
        error: latest.error?.message ?? null,
      };
    }
    return none;
  }
  // Same content as the current render? A changed text or picture makes it stale.
  const fresh = await loadRenderInput(ctx, v.id)
    .then((input) => input.inputHash === current.inputHash)
    .catch(() => true);
  return {
    state: fresh ? "READY" : inFlight ? "RENDERING" : "STALE",
    renderId: current.id,
    slides,
    qa: current.qaReport,
    error: null,
  };
}

export async function getReviewBundle(
  ctx: ServiceContext,
  masterIdeaId: string,
): Promise<ReviewBundle> {
  const idea = await getIdeaDetail(ctx, masterIdeaId);
  const rows = await ctx.db
    .select({
      v: schema.contentVariants,
      marketCode: schema.markets.code,
      marketName: schema.markets.displayName,
      flagEmoji: schema.markets.flagEmoji,
      offerName: schema.offers.name,
      offerType: schema.offers.type,
    })
    .from(schema.contentVariants)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.contentVariants.marketId))
    .leftJoin(schema.offers, eq(schema.offers.id, schema.contentVariants.offerId))
    .where(eq(schema.contentVariants.masterIdeaId, masterIdeaId))
    .orderBy(asc(schema.markets.sortOrder), asc(schema.markets.code));

  const [cost] = await ctx.db
    .select({
      total: sql<string | null>`sum(${schema.generationRuns.costUsd})`,
      runs: sql<number>`count(*)::int`,
    })
    .from(schema.generationRuns)
    .where(eq(schema.generationRuns.masterIdeaId, masterIdeaId));

  const live = rows.filter((r) => r.v.status !== "REJECTED");
  const renders = new Map(
    await Promise.all(live.map(async (r) => [r.v.id, await renderView(ctx, r.v)] as const)),
  );

  return {
    idea,
    variants: live.map(({ v, marketCode, marketName, flagEmoji, offerName, offerType }) => ({
      id: v.id,
      marketCode,
      marketName,
      flagEmoji,
      status: v.status,
      qualityScore: v.qualityScore === null ? null : Number(v.qualityScore),
      flags: v.flags,
      hook: v.hook,
      hookType: v.hookType,
      caption: v.caption,
      cta: v.ctaJson,
      hashtags: v.hashtags,
      slides: v.slidesJson.map(inTemplateOrder),
      brief: v.marketBriefJson,
      visualBrief: v.visualBriefJson,
      render: renders.get(v.id) as RenderView,
      critic: v.criticReport,
      differentiation: v.differentiationReport,
      offer: offerName && offerType ? { name: offerName, type: offerType } : null,
      generationVersion: v.generationVersion,
      generationConfig: v.generationConfig,
      lastError: v.lastError ? { code: v.lastError.code, message: v.lastError.message } : null,
      hasContent: v.slidesJson.length > 0,
      lockVersion: v.lockVersion,
      updatedAt: v.updatedAt,
    })),
    costUsd: cost?.total == null ? null : Number(cost.total),
  };
}
