import { schema } from "@rc/db";
import { and, asc, eq, inArray, ne } from "@rc/db/orm";
import type { ServiceContext } from "../../core";

/**
 * The ideas that use each card, by card id (plan 05 §5.4 "used by ideas", M2-13a): ideas linked to
 * the card through `master_idea_knowledge`, archived ideas left out. The card screen lists them
 * and merging refuses a card an idea uses.
 */
export async function ideasUsingCards(
  ctx: ServiceContext,
  cardIds: readonly string[],
): Promise<Map<string, { id: string; topic: string }[]>> {
  const used = new Map<string, { id: string; topic: string }[]>();
  if (cardIds.length === 0) return used;
  const rows = await ctx.db
    .select({
      cardId: schema.masterIdeaKnowledge.knowledgeItemId,
      id: schema.masterIdeas.id,
      topic: schema.masterIdeas.topic,
    })
    .from(schema.masterIdeaKnowledge)
    .innerJoin(
      schema.masterIdeas,
      eq(schema.masterIdeas.id, schema.masterIdeaKnowledge.masterIdeaId),
    )
    .where(
      and(
        inArray(schema.masterIdeaKnowledge.knowledgeItemId, [...cardIds]),
        ne(schema.masterIdeas.status, "ARCHIVED"),
      ),
    )
    .orderBy(asc(schema.masterIdeas.topic), asc(schema.masterIdeas.id));
  for (const row of rows) {
    const list = used.get(row.cardId) ?? [];
    list.push({ id: row.id, topic: row.topic });
    used.set(row.cardId, list);
  }
  return used;
}
