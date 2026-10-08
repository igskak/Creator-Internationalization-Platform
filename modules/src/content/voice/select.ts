import { schema } from "@rc/db";
import { and, desc, eq, inArray, isNull, or } from "@rc/db/orm";
import type { ServiceContext } from "../../core";

// What the writer is shown to learn a market's voice (plan 07 §7.11 v1, M2-17): the standing
// rules and seed examples, up to three approved drafts of this market, and the last ten edit pairs
// with their reasons. Examples built from a source whose rights forbid improving prompts with it
// are left out ([S§6.2]).

export type Exemplar = {
  kind: "EXEMPLAR" | "EDIT_PAIR" | "RULE";
  text?: string;
  before?: string;
  after?: string;
  note?: string;
};

export const MAX_APPROVED_EXEMPLARS = 3;
export const MAX_EDIT_PAIRS = 10;
export const MAX_SEED_ROWS = 10;
/** An approved draft is an example only if it was approved with at most this many edits. */
export const MAX_EDITS_OF_EXEMPLAR = 2;
const MAX_EXEMPLAR_CHARS = 1500;
/** Statuses of a draft that a person approved. */
const APPROVED = ["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED"] as const;

const renderVariant = (v: typeof schema.contentVariants.$inferSelect): string =>
  [
    `Hook: ${v.hook ?? ""}`,
    "Slides:",
    ...v.slidesJson.map((s, i) => `${i + 1}. ${Object.values(s.slots).join(" / ")}`),
    `Caption: ${v.caption ?? ""}`,
  ]
    .join("\n")
    .slice(0, MAX_EXEMPLAR_CHARS);

/** Ids of the cards a variant cites on its slides. */
const citedCards = (v: { slidesJson: { knowledgeIds: string[] }[] }) => [
  ...new Set(v.slidesJson.flatMap((s) => s.knowledgeIds)),
];

/** Source ids whose rights say the source may not be used to improve prompts. */
async function deniedSources(
  ctx: ServiceContext,
  cardIds: readonly string[],
): Promise<Set<string>> {
  if (cardIds.length === 0) return new Set();
  const cards = await ctx.db
    .select({ id: schema.knowledgeItems.id, sourceId: schema.knowledgeItems.sourceAssetId })
    .from(schema.knowledgeItems)
    .where(inArray(schema.knowledgeItems.id, [...cardIds]));
  const sourceIds = [...new Set(cards.flatMap((c) => (c.sourceId ? [c.sourceId] : [])))];
  if (sourceIds.length === 0) return new Set();
  const sources = await ctx.db
    .select({ id: schema.sourceAssets.id, rights: schema.sourceAssets.rights })
    .from(schema.sourceAssets)
    .where(inArray(schema.sourceAssets.id, sourceIds));
  const denied = new Set(
    sources.filter((s) => s.rights.improvePrompts === "DENIED").map((s) => s.id),
  );
  return new Set(cards.filter((c) => c.sourceId && denied.has(c.sourceId)).map((c) => c.id));
}

/**
 * The examples for one market, in the order the writer reads them: rules, seed examples, approved
 * drafts of the market, edit pairs (newest first). Rows for another language or another market, and
 * inactive rows, are not included.
 */
export async function selectExemplars(ctx: ServiceContext, marketId: string): Promise<Exemplar[]> {
  const [market] = await ctx.db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, marketId));
  if (!market) return [];

  const rows = await ctx.db
    .select()
    .from(schema.voiceExamples)
    .where(
      and(
        eq(schema.voiceExamples.isActive, true),
        or(eq(schema.voiceExamples.marketId, marketId), isNull(schema.voiceExamples.marketId)),
        or(
          eq(schema.voiceExamples.language, market.language),
          isNull(schema.voiceExamples.language),
        ),
      ),
    )
    .orderBy(desc(schema.voiceExamples.createdAt), desc(schema.voiceExamples.id));
  const clean = <T extends Record<string, string | null>>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Record<string, string>;

  const rules = rows
    .filter((r) => r.kind === "RULE")
    .slice(0, MAX_SEED_ROWS)
    .map((r): Exemplar => ({ kind: "RULE", ...clean({ text: r.note }) }));
  const seeds = rows
    .filter((r) => r.kind === "EXEMPLAR")
    .slice(0, MAX_SEED_ROWS)
    .map((r): Exemplar => ({ kind: "EXEMPLAR", ...clean({ text: r.afterText, note: r.note }) }));
  const pairs = rows
    .filter((r) => r.kind === "EDIT_PAIR")
    .slice(0, MAX_EDIT_PAIRS)
    .map(
      (r): Exemplar => ({
        kind: "EDIT_PAIR",
        ...clean({ before: r.beforeText, after: r.afterText, note: r.note }),
      }),
    );

  // Approved drafts: the newest first, few edits, and nothing built on a source that denies it.
  // Until review events exist (M4) the edits of a draft are counted from its lock version, which
  // goes up by one for the generation and by one for every later change.
  const approved = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(
      and(
        eq(schema.contentVariants.marketId, marketId),
        inArray(schema.contentVariants.status, [...APPROVED]),
      ),
    )
    .orderBy(desc(schema.contentVariants.statusChangedAt), desc(schema.contentVariants.id));
  const candidates = approved.filter(
    (v) => v.hook && v.slidesJson.length > 0 && v.lockVersion - 1 <= MAX_EDITS_OF_EXEMPLAR,
  );
  const denied = await deniedSources(ctx, candidates.flatMap(citedCards));
  const drafts = candidates
    .filter((v) => !citedCards(v).some((id) => denied.has(id)))
    .slice(0, MAX_APPROVED_EXEMPLARS)
    .map((v): Exemplar => ({ kind: "EXEMPLAR", text: renderVariant(v) }));

  return [...rules, ...seeds, ...drafts, ...pairs];
}
