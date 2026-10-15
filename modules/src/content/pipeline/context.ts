import { schema } from "@rc/db";
import { and, asc, desc, eq, inArray, ne } from "@rc/db/orm";
import { InvalidStateError, NotFoundError } from "@rc/lib/errors";
import type { contentWriter } from "@rc/prompts";
import { registry, type TemplateDefinition } from "@rc/templates";
import type { ServiceContext } from "../../core";
import { getIdeaCards, type IdeaCard } from "../../knowledge/retrieval";
import {
  latestMemory,
  learningLabels,
  topExemplarsByD7,
  writerLearning,
  writerUsesLearning,
} from "../learning";
import { type Exemplar, selectExemplars } from "../voice";

// What the generation pipeline reads before it starts (plan 07 §7.6.2, §7.9.2): the idea, the
// exact approved card versions it links, the markets, the offers, the taxonomy and the templates.

export type PipelineIdea = typeof schema.masterIdeas.$inferSelect;
export type PipelineVariant = typeof schema.contentVariants.$inferSelect;
export type PipelineMarket = typeof schema.markets.$inferSelect;
export type PipelineOffer = typeof schema.offers.$inferSelect;

export type TaxonomyTerm = { code: string; label: string; description?: string };

export type PipelineContext = {
  idea: PipelineIdea;
  brandVoice: string;
  /** The approved snapshots the idea was built on (closed book). */
  cards: IdeaCard[];
  /** The variants of this run. */
  variants: PipelineVariant[];
  /** Other live variants of the idea: constraints for the plans and the comparison, never changed. */
  others: PipelineVariant[];
  markets: Map<string, PipelineMarket>;
  /** Highest-priority ACTIVE offer of the idea's product per market id. */
  offers: Map<string, PipelineOffer>;
  /** What the writer learns each market's voice from (M2-17), by market id. */
  exemplars: Map<string, Exemplar[]>;
  /** What the market's performance memory tells the writer (M7-04), by market id; empty when unused. */
  learning: Map<string, contentWriter.WriterLearning>;
  hookTypes: TaxonomyTerm[];
  ctaTypes: TaxonomyTerm[];
  /** P0 templates: the only ones a plan may use. */
  templates: readonly Readonly<TemplateDefinition>[];
};

const terms = (rows: { code: string; label: string; description: string | null }[]) =>
  rows.map((r) => ({
    code: r.code,
    label: r.label,
    ...(r.description ? { description: r.description } : {}),
  }));

/** The P0 templates of the registry, as the prompts and validators see them. */
export const p0Templates = () => registry.list({ priority: "P0" });

/** A `get` that knows only the P0 templates (P1 ones are not rendered in the MVP). */
export const p0Registry = {
  get: (id: string) => {
    const template = registry.get(id);
    return template?.priority === "P0" ? template : undefined;
  },
};

export async function loadPipelineContext(
  ctx: ServiceContext,
  masterIdeaId: string,
  variantIds: readonly string[],
  options: {
    /** The content-writer version that will run; default the active one. */
    writerVersion?: number;
  } = {},
): Promise<PipelineContext> {
  const [idea] = await ctx.db
    .select()
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, masterIdeaId));
  if (!idea) throw new NotFoundError("Idea not found.", { details: { masterIdeaId } });
  if (idea.status !== "ACCEPTED") {
    throw new InvalidStateError(
      `An idea must be ACCEPTED to generate drafts, this one is ${idea.status}.`,
      {
        details: { masterIdeaId, status: idea.status },
      },
    );
  }

  const live = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(
      and(
        eq(schema.contentVariants.masterIdeaId, masterIdeaId),
        // A Reel is made from a carousel and has no draft pipeline of its own (M8-06).
        eq(schema.contentVariants.format, "CAROUSEL"),
        ne(schema.contentVariants.status, "REJECTED"),
      ),
    );
  const missing = variantIds.filter((id) => !live.some((v) => v.id === id));
  if (missing.length > 0) {
    throw new NotFoundError("Some variants do not belong to this idea.", { details: { missing } });
  }
  const variants = variantIds.map((id) => live.find((v) => v.id === id) as PipelineVariant);
  const others = live.filter((v) => !variantIds.includes(v.id));

  const [brand] = await ctx.db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.id, idea.brandId));
  const marketIds = [...new Set(variants.map((v) => v.marketId))];
  const marketRows = await ctx.db
    .select()
    .from(schema.markets)
    .where(inArray(schema.markets.id, marketIds));

  const offers = new Map<string, PipelineOffer>();
  if (idea.productId) {
    const rows = await ctx.db
      .select()
      .from(schema.offers)
      .where(
        and(
          eq(schema.offers.productId, idea.productId),
          eq(schema.offers.status, "ACTIVE"),
          inArray(schema.offers.marketId, marketIds),
        ),
      )
      .orderBy(desc(schema.offers.priority), asc(schema.offers.name), asc(schema.offers.id));
    for (const offer of rows) if (!offers.has(offer.marketId)) offers.set(offer.marketId, offer);
  }

  const taxonomy = await ctx.db
    .select()
    .from(schema.taxonomyTerms)
    .where(
      and(
        inArray(schema.taxonomyTerms.kind, ["hook_type", "cta_type"]),
        eq(schema.taxonomyTerms.isActive, true),
      ),
    )
    .orderBy(asc(schema.taxonomyTerms.sortOrder), asc(schema.taxonomyTerms.code));

  // M7-04: a writer that has the rules for it gets the market's memory and its best posts at D7.
  const exemplars = new Map(
    await Promise.all(
      marketIds.map(async (id) => [id, await selectExemplars(ctx, id)] as [string, Exemplar[]]),
    ),
  );
  const learning = new Map<string, contentWriter.WriterLearning>();
  if (writerUsesLearning(options.writerVersion)) {
    const labels = await learningLabels(ctx);
    for (const id of marketIds) {
      const memory = await latestMemory(ctx, id);
      if (memory) learning.set(id, writerLearning(memory.memory, labels));
      exemplars.set(id, [...(exemplars.get(id) ?? []), ...(await topExemplarsByD7(ctx, id))]);
    }
  }

  return {
    idea,
    brandVoice: brand?.brandVoice ?? "",
    cards: await getIdeaCards(ctx, masterIdeaId),
    variants,
    others,
    markets: new Map(marketRows.map((m) => [m.id, m])),
    offers,
    exemplars,
    learning,
    hookTypes: terms(taxonomy.filter((t) => t.kind === "hook_type")),
    ctaTypes: terms(taxonomy.filter((t) => t.kind === "cta_type")),
    templates: p0Templates(),
  };
}
