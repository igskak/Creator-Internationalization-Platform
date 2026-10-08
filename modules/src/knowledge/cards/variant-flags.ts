import { schema } from "@rc/db";
import type { VariantFlag } from "@rc/db/json";
import { eq, inArray, notInArray } from "@rc/db/orm";
import { audit, type ServiceContext } from "../../core";

// Variants that cite a card the chef later changed (plan 05 §5.4, 10 §10.4.1, M2-13a): a card
// edited after approval raises KNOWLEDGE_CHANGED (a warning), an archived one KNOWLEDGE_ARCHIVED
// (blocks approval). Published variants (and the one being published) are never touched.

/** A variant in these statuses is out in the world or finished: its flags stay as they were. */
const UNTOUCHED = ["PUBLISHING", "PUBLISHED", "REJECTED"] as const;

type Citing = {
  id: string;
  marketId: string;
  flags: string[];
  /** Every card the variant cites, on slides and in the claims. */
  cited: string[];
};

/** The not-yet-published variants whose slides cite one of the cards. */
async function citingVariants(ctx: ServiceContext, cardIds: readonly string[]): Promise<Citing[]> {
  if (cardIds.length === 0) return [];
  const rows = await ctx.db
    .select({
      id: schema.contentVariants.id,
      marketId: schema.contentVariants.marketId,
      flags: schema.contentVariants.flags,
      slides: schema.contentVariants.slidesJson,
    })
    .from(schema.contentVariants)
    .where(notInArray(schema.contentVariants.status, [...UNTOUCHED]));
  return rows
    .map((row) => ({
      id: row.id,
      marketId: row.marketId,
      flags: row.flags,
      cited: [...new Set(row.slides.flatMap((slide) => slide.knowledgeIds))],
    }))
    .filter((v) => v.cited.some((id) => cardIds.includes(id)));
}

async function setFlags(
  ctx: ServiceContext,
  variant: Citing,
  flags: string[],
  audited: { action: string; data: Record<string, unknown> },
) {
  await ctx.db
    .update(schema.contentVariants)
    .set({ flags })
    .where(eq(schema.contentVariants.id, variant.id));
  await audit(ctx, {
    action: audited.action,
    entityType: "content_variant",
    entityId: variant.id,
    marketId: variant.marketId,
    data: { ...audited.data, flags },
  });
}

/**
 * Adds `flag` to every unpublished variant that cites one of the cards. Returns the ids of the
 * variants that got it (those that already had it are left out).
 */
export async function flagVariantsCiting(
  ctx: ServiceContext,
  cardIds: readonly string[],
  flag: Extract<VariantFlag, "KNOWLEDGE_CHANGED" | "KNOWLEDGE_ARCHIVED">,
): Promise<string[]> {
  const flagged: string[] = [];
  for (const variant of await citingVariants(ctx, cardIds)) {
    if (variant.flags.includes(flag)) continue;
    await setFlags(ctx, variant, [...variant.flags, flag], {
      action: "variant.flagged",
      data: { flag, cardIds: variant.cited.filter((id) => cardIds.includes(id)) },
    });
    flagged.push(variant.id);
  }
  return flagged;
}

/**
 * After a card is approved again: removes KNOWLEDGE_CHANGED from the variants that cite it when
 * every card they cite is approved, and KNOWLEDGE_ARCHIVED when none of them is archived any more.
 * A variant that still cites another changed card keeps the flag.
 */
export async function clearKnowledgeFlags(
  ctx: ServiceContext,
  cardIds: readonly string[],
): Promise<string[]> {
  const cleared: string[] = [];
  const variants = (await citingVariants(ctx, cardIds)).filter(
    (v) => v.flags.includes("KNOWLEDGE_CHANGED") || v.flags.includes("KNOWLEDGE_ARCHIVED"),
  );
  if (variants.length === 0) return cleared;
  const status = new Map(
    (
      await ctx.db
        .select({ id: schema.knowledgeItems.id, status: schema.knowledgeItems.reviewStatus })
        .from(schema.knowledgeItems)
        .where(inArray(schema.knowledgeItems.id, [...new Set(variants.flatMap((v) => v.cited))]))
    ).map((card) => [card.id, card.status]),
  );
  for (const variant of variants) {
    const states = variant.cited.map((id) => status.get(id));
    const drop = new Set<string>();
    if (states.every((s) => s === "CHEF_APPROVED")) drop.add("KNOWLEDGE_CHANGED");
    if (!states.some((s) => s === "ARCHIVED")) drop.add("KNOWLEDGE_ARCHIVED");
    const next = variant.flags.filter((f) => !drop.has(f));
    if (next.length === variant.flags.length) continue;
    await setFlags(ctx, variant, next, {
      action: "variant.flag_cleared",
      data: { cleared: variant.flags.filter((f) => drop.has(f)), cardIds: [...cardIds] },
    });
    cleared.push(variant.id);
  }
  return cleared;
}
