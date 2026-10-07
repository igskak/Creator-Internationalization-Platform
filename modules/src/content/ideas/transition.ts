import { schema } from "@rc/db";
import { and, eq, inArray, ne } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { type ServiceContext, transition } from "../../core";

type Idea = typeof schema.masterIdeas.$inferSelect;
type Status = Idea["status"];

export const TransitionIdeaInput = z.object({
  id: z.uuid(),
  to: z.enum(["ACCEPTED", "REJECTED", "ARCHIVED", "PROPOSED"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Plan 10 §10.4.2: accept and reject from PROPOSED, archive, restore from REJECTED or ARCHIVED.
 * Archiving is also allowed from PROPOSED and REJECTED (the table lists ACCEPTED only): a rejected
 * idea has to be archivable, or the source behind it could never be (M2-01a).
 */
const ALLOWED_FROM: Record<z.infer<typeof TransitionIdeaInput>["to"], Status[]> = {
  ACCEPTED: ["PROPOSED"],
  REJECTED: ["PROPOSED"],
  ARCHIVED: ["PROPOSED", "ACCEPTED", "REJECTED"],
  PROPOSED: ["REJECTED", "ARCHIVED"],
};

/** Variants in these statuses are approved or live: the idea cannot be archived under them. */
const LIVE_VARIANT_STATUSES = ["APPROVED", "SCHEDULED", "PUBLISHING"] as const;

export async function transitionIdea(
  ctx: ServiceContext,
  raw: z.input<typeof TransitionIdeaInput>,
): Promise<Idea> {
  const parsed = TransitionIdeaInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { id, to } = parsed.data;
  const reason = parsed.data.reason || undefined;

  if (to === "REJECTED" && !reason) {
    throw new ValidationError("Say why the idea is rejected.", {
      fieldErrors: { reason: ["A reason is required."] },
    });
  }
  const [idea] = await ctx.db
    .select()
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, id));
  if (!idea) throw new NotFoundError("Idea not found.", { details: { id } });

  if (to === "ACCEPTED") {
    const stale = await ctx.db
      .select({
        id: schema.knowledgeItems.id,
        title: schema.knowledgeItems.title,
        status: schema.knowledgeItems.reviewStatus,
      })
      .from(schema.masterIdeaKnowledge)
      .innerJoin(
        schema.knowledgeItems,
        eq(schema.knowledgeItems.id, schema.masterIdeaKnowledge.knowledgeItemId),
      )
      .where(
        and(
          eq(schema.masterIdeaKnowledge.masterIdeaId, id),
          ne(schema.knowledgeItems.reviewStatus, "CHEF_APPROVED"),
        ),
      );
    if (stale.length > 0) {
      throw new InvalidStateError("Some cards of this idea are no longer approved.", {
        details: { cards: stale },
      });
    }
  }
  if (to === "ARCHIVED") {
    const live = await ctx.db
      .select({ id: schema.contentVariants.id, status: schema.contentVariants.status })
      .from(schema.contentVariants)
      .where(
        and(
          eq(schema.contentVariants.masterIdeaId, id),
          inArray(schema.contentVariants.status, [...LIVE_VARIANT_STATUSES]),
        ),
      );
    if (live.length > 0) {
      throw new InvalidStateError("A variant of this idea is approved, scheduled or publishing.", {
        details: { variants: live },
      });
    }
  }

  return transition(ctx, {
    table: schema.masterIdeas,
    id,
    from: ALLOWED_FROM[to],
    to,
    // A rejection keeps its reason when the idea is archived later; restoring clears it.
    ...(to === "REJECTED"
      ? { set: { rejectedReason: reason ?? null } }
      : to === "PROPOSED"
        ? { set: { rejectedReason: null } }
        : {}),
    audit: {
      action: `idea.${to.toLowerCase()}`,
      entityType: "master_idea",
      data: reason ? { reason } : {},
    },
  });
}
