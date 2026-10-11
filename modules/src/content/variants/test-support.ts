import { createHash } from "node:crypto";
import { schema } from "@rc/db";
import type { Slide } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { createLogger } from "@rc/lib/logging";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import {
  createServiceContext,
  type InstagramRuntime,
  type JobRunner,
  manualClock,
  type ServiceContext,
  type TriggerOptions,
} from "../../core";
import { loadRenderInput } from "../../visuals";
import { hashSnapshot } from "./approve";

// Fixtures for the tests of the review and scheduling services (M4). Synthetic content only.

type Db = ServiceContext["db"];
type VariantStatus = (typeof schema.contentVariants.$inferSelect)["status"];

export const testLogger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

export type RecordedJob = { name: string; payload: unknown; options?: TriggerOptions };

/** A job runner that only records what was queued. */
export function recordingJobs(): { runner: JobRunner; calls: RecordedJob[] } {
  const calls: RecordedJob[] = [];
  return {
    calls,
    runner: {
      trigger: async (name, payload, options) => {
        calls.push({ name, payload, ...(options ? { options } : {}) });
        return { runId: `run-${calls.length}` };
      },
      triggerAndWaitAll: async () => [],
    },
  };
}

const slide = (
  id: string,
  index: number,
  templateId: Slide["templateId"],
  role: Slide["role"],
  slots: Record<string, string>,
): Slide => ({ id, index, role, templateId, slots, images: {}, knowledgeIds: [], factual: false });

export const fixtureSlides = (): Slide[] => [
  slide("s1", 0, "A", "HOOK", { headline: "Hola" }),
  slide("s2", 1, "B", "FACT", { body: "Texto." }),
  slide("s3", 2, "F", "CTA", { headline: "Guárdalo", body: "Gracias." }),
];

export type ReviewFixture = {
  ctx: ServiceContext;
  /** The same context acting as a user of the given role. */
  as: (role: "owner" | "editor" | "chef") => ServiceContext;
  userId: string;
  ideaId: string;
  marketId: string;
  storage: ReturnType<typeof createMemoryStorage>;
  clock: ReturnType<typeof manualClock>;
  /** Makes a variant for the market (default es-ES) with content, in the given status. */
  makeVariant: (opts?: MakeVariantOptions) => Promise<{ variantId: string; marketId: string }>;
  /** Inserts a READY render of the variant's current content and makes it the current one. */
  makeRender: (variantId: string) => Promise<string>;
  variant: (variantId: string) => Promise<typeof schema.contentVariants.$inferSelect>;
  /** Writes an approved snapshot of the variant bound to a fresh render and points the variant at it. */
  makeVersion: (variantId: string) => Promise<{ versionId: string; renderId: string }>;
  /** Inserts a publication of the variant's approved version. */
  makePublication: (
    variantId: string,
    versionId: string,
    over?: Partial<typeof schema.publications.$inferInsert>,
  ) => Promise<string>;
};

export type MakeVariantOptions = {
  status?: VariantStatus;
  marketCode?: string;
  flags?: string[];
  commercial?: boolean;
  /** Add a product offer for the market and link it to the variant. */
  withOffer?: boolean;
  ctaType?: string;
  /** Default: a new idea of its own (one live variant per idea and market). */
  ideaId?: string;
  /** Set at insert (the update trigger overwrites it afterwards). */
  updatedAt?: Date;
  qualityScore?: string;
};

/**
 * Seeds (seedDatabase must have run) an ACCEPTED idea, an owner and helpers to make variants and
 * renders. Time is a manual clock at 2026-10-10 12:00 UTC.
 */
export async function reviewFixture(
  db: Db,
  options: { jobs?: JobRunner; instagram?: InstagramRuntime } = {},
): Promise<ReviewFixture> {
  const storage = createMemoryStorage();
  const clock = manualClock("2026-10-10T12:00:00Z");
  const [owner] = await db.select().from(schema.appUsers);
  const userId = owner?.id ?? "";
  const make = (role: "owner" | "editor" | "chef") =>
    createServiceContext({
      db,
      logger: testLogger,
      clock,
      storage,
      ...(options.jobs ? { jobs: options.jobs } : {}),
      ...(options.instagram ? { instagram: options.instagram } : {}),
      actor: { type: "USER", userId, role },
    });
  const ctx = make("owner");

  const [brand] = await db.select().from(schema.brands);
  const [idea] = await db
    .insert(schema.masterIdeas)
    .values({
      brandId: brand?.id ?? "",
      topic: "Rice",
      category: "GRAINS_RICE_PASTA",
      angle: "COMMON_MISTAKE",
      coreMessage: "Do not rinse risotto rice.",
      status: "ACCEPTED",
      origin: "MANUAL",
    })
    .returning();
  const ideaId = idea?.id ?? "";
  const [es] = await db.select().from(schema.markets).where(eq(schema.markets.code, "es-ES"));

  const variant = async (variantId: string) => {
    const [v] = await db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variantId));
    return v as typeof schema.contentVariants.$inferSelect;
  };

  const makeVariant: ReviewFixture["makeVariant"] = async (opts = {}) => {
    const [market] = opts.marketCode
      ? await db.select().from(schema.markets).where(eq(schema.markets.code, opts.marketCode))
      : [es];
    const [own] = opts.ideaId
      ? [{ id: opts.ideaId }]
      : await db
          .insert(schema.masterIdeas)
          .values({
            brandId: brand?.id ?? "",
            topic: "Rice",
            category: "GRAINS_RICE_PASTA",
            angle: "COMMON_MISTAKE",
            coreMessage: "Do not rinse risotto rice.",
            status: "ACCEPTED",
            origin: "MANUAL",
            commercialIntent: opts.commercial ? "LEAD_MAGNET" : "NONE",
          })
          .returning();
    const ideaForVariant = own?.id ?? "";
    let offerId: string | null = null;
    if (opts.withOffer) {
      const [product] = await db
        .insert(schema.products)
        .values({
          brandId: brand?.id ?? "",
          code: `p-${Math.random().toString(36).slice(2, 8)}`,
          name: "Guide",
          type: "GUIDE",
          originalLanguage: "ru",
        })
        .returning();
      const [offer] = await db
        .insert(schema.offers)
        .values({
          marketId: market?.id ?? "",
          productId: product?.id ?? "",
          name: "Guide",
          type: "LEAD_MAGNET",
          currency: "EUR",
          landingUrl: "https://example.test/guide",
          defaultKeyword: "GUIDE",
          status: "ACTIVE",
        })
        .returning();
      offerId = offer?.id ?? null;
    }
    const type = opts.ctaType ?? "SAVE";
    const [row] = await db
      .insert(schema.contentVariants)
      .values({
        masterIdeaId: ideaForVariant,
        marketId: market?.id ?? "",
        status: opts.status ?? "READY_FOR_REVIEW",
        hook: "Hola",
        hookType: "QUESTION",
        caption: "Un pie de foto.",
        cta: "Guárdalo",
        ctaType: type,
        ctaJson: {
          type,
          text: "Guárdalo",
          ...(type.endsWith("KEYWORD") ? { keyword: "GUIA" } : {}),
        },
        hashtags: ["#cocina"],
        slidesJson: fixtureSlides(),
        templateSequence: ["A", "B", "F"],
        visualStyle: "WARM",
        generationVersion: "1.2.0",
        flags: opts.flags ?? [],
        offerId,
        ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
        ...(opts.qualityScore ? { qualityScore: opts.qualityScore } : {}),
      })
      .returning();
    return { variantId: row?.id ?? "", marketId: market?.id ?? "" };
  };

  const makeRender: ReviewFixture["makeRender"] = async (variantId) => {
    // The input hash is only computed for a variant in review: look at it as one, then restore.
    const status = (await variant(variantId)).status;
    const setStatus = (to: VariantStatus) =>
      db
        .update(schema.contentVariants)
        .set({ status: to })
        .where(eq(schema.contentVariants.id, variantId));
    await setStatus("READY_FOR_REVIEW");
    const { inputHash } = await loadRenderInput(ctx, variantId);
    await setStatus(status);
    const [row] = await db
      .insert(schema.carouselRenders)
      .values({ contentVariantId: variantId, inputHash, status: "READY", templatesVersion: "t" })
      .returning();
    const id = row?.id ?? "";
    for (const [i, s] of fixtureSlides().entries()) {
      const key = `renders/${variantId}/${id}/${i}.jpg`;
      await storage.put(key, "x", { contentType: "image/jpeg" });
      await db.insert(schema.renderedSlides).values({
        carouselRenderId: id,
        slideIndex: i,
        slideId: s.id,
        templateId: s.templateId,
        storageKey: key,
        width: 1080,
        height: 1350,
        bytes: 1,
        // The sha of the stored bytes ("x"): the publisher checks the file against it.
        sha256: createHash("sha256").update("x").digest("hex"),
      });
    }
    await db
      .update(schema.contentVariants)
      .set({ currentRenderId: id })
      .where(eq(schema.contentVariants.id, variantId));
    return id;
  };

  const makeVersion: ReviewFixture["makeVersion"] = async (variantId) => {
    const renderId = await makeRender(variantId);
    const v = await variant(variantId);
    const files = await db
      .select({ key: schema.renderedSlides.storageKey })
      .from(schema.renderedSlides)
      .where(eq(schema.renderedSlides.carouselRenderId, renderId))
      .orderBy(schema.renderedSlides.slideIndex);
    const snapshot = {
      hook: v.hook ?? "",
      hookType: v.hookType ?? "",
      caption: v.caption ?? "",
      cta: v.ctaJson ?? { type: "SAVE", text: "" },
      hashtags: v.hashtags,
      slides: v.slidesJson,
      visualStyle: v.visualStyle ?? "",
      templateSequence: v.templateSequence,
      renderId,
      renderedSlideKeys: files.map((f) => f.key),
      knowledge: [],
      generationVersion: v.generationVersion ?? "",
    };
    const [version] = await db
      .insert(schema.contentVariantVersions)
      .values({
        contentVariantId: variantId,
        versionNo: 1,
        snapshot,
        carouselRenderId: renderId,
        contentHash: hashSnapshot(snapshot),
        approvedBy: userId,
      })
      .returning();
    await db
      .update(schema.contentVariants)
      .set({ approvedVersionId: version?.id ?? null })
      .where(eq(schema.contentVariants.id, variantId));
    return { versionId: version?.id ?? "", renderId };
  };

  let publicationCount = 0;
  const makePublication: ReviewFixture["makePublication"] = async (variantId, versionId, over) => {
    const v = await variant(variantId);
    publicationCount += 1;
    const [pub] = await db
      .insert(schema.publications)
      .values({
        contentVariantId: variantId,
        contentVariantVersionId: versionId,
        marketId: v.marketId,
        mode: "SCHEDULED",
        scheduledAt: new Date("2026-12-01T10:00:00Z"),
        status: "SCHEDULED",
        idempotencyKey: `pub:test-${publicationCount}:0`,
        ...over,
      })
      .returning();
    return pub?.id ?? "";
  };

  return {
    ctx,
    as: make,
    userId,
    ideaId,
    marketId: es?.id ?? "",
    storage,
    clock,
    makeVariant,
    makeRender,
    variant,
    makeVersion,
    makePublication,
  };
}
