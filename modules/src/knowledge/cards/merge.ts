import { schema } from "@rc/db";
import { eq, inArray } from "@rc/db/orm";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../../core";
import { ideasUsingCards } from "./usage";

// Merging duplicates (plan 05 §5.4 `mergeDuplicateCards`, M1-20): the cards that repeat another one
// are archived as DUPLICATE and point at the one that stays.

export const MergeDuplicatesInput = z.object({
  keepId: z.uuid(),
  duplicateIds: z.array(z.uuid()).min(1).max(20),
});

export async function mergeDuplicateCards(
  ctx: ServiceContext,
  raw: z.input<typeof MergeDuplicatesInput>,
): Promise<{ archived: number }> {
  const parsed = MergeDuplicatesInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { keepId } = parsed.data;
  const duplicateIds = [...new Set(parsed.data.duplicateIds)];
  if (ctx.actor.type === "USER" && ctx.actor.role !== "chef" && ctx.actor.role !== "owner") {
    throw new ForbiddenError("Only the chef or the owner can merge cards.");
  }
  if (duplicateIds.includes(keepId)) {
    throw new ValidationError("A card cannot be merged into itself.", {
      fieldErrors: { duplicateIds: ["Choose other cards than the one that stays."] },
    });
  }

  const cards = await ctx.db
    .select()
    .from(schema.knowledgeItems)
    .where(inArray(schema.knowledgeItems.id, [keepId, ...duplicateIds]));
  const byId = new Map(cards.map((card) => [card.id, card]));
  const keep = byId.get(keepId);
  if (!keep) throw new NotFoundError("Knowledge card not found.", { details: { id: keepId } });
  if (keep.reviewStatus === "ARCHIVED") {
    throw new ConflictError("The card that stays is archived. Restore it or choose another one.", {
      details: { id: keepId },
    });
  }
  for (const id of duplicateIds) {
    const card = byId.get(id);
    if (!card) throw new NotFoundError("Knowledge card not found.", { details: { id } });
    if (card.reviewStatus === "ARCHIVED") {
      throw new ConflictError("One of the cards is already archived.", { details: { id } });
    }
  }

  const used = await ideasUsingCards(ctx, duplicateIds);
  const blocking = duplicateIds.filter((id) => (used.get(id)?.length ?? 0) > 0);
  if (blocking.length > 0) {
    throw new ConflictError("A card used by an idea cannot be merged. Archive it instead.", {
      details: { ids: blocking },
    });
  }

  await withTransaction(ctx, async (tx) => {
    for (const id of duplicateIds) {
      const card = byId.get(id);
      const [row] = await tx.db
        .update(schema.knowledgeItems)
        .set({ reviewStatus: "ARCHIVED", archiveReason: "DUPLICATE", duplicateOfId: keepId })
        .where(eq(schema.knowledgeItems.id, id))
        .returning({ id: schema.knowledgeItems.id });
      if (!row) throw new ConflictError("The card changed while merging.", { details: { id } });
      await audit(tx, {
        action: "knowledge.merged",
        entityType: "knowledge_item",
        entityId: id,
        data: {
          keepId,
          from: card?.reviewStatus,
          to: "ARCHIVED",
          wasApproved: card?.reviewStatus === "CHEF_APPROVED",
        },
      });
    }
  });
  return { archived: duplicateIds.length };
}
