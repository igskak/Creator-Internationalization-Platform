import { schema } from "@rc/db";
import { and, eq, inArray, sql } from "@rc/db/orm";
import { NotFoundError } from "@rc/lib/errors";
import { audit, type ServiceContext, transition, withTransaction } from "../../core";
import { assertTransition, type VariantEvent } from "./state";

type Variant = typeof schema.contentVariants.$inferSelect;

export type TransitionVariantInput = {
  variantId: string;
  event: VariantEvent;
  /** Other columns to change in the same update. */
  set?: Partial<Omit<typeof schema.contentVariants.$inferInsert, "status" | "id">>;
  /** Added to the audit event next to the event name. */
  data?: Record<string, unknown>;
  /** Why (an un-approve or a rejection); stored in the audit event. */
  reason?: string;
};

/** Publications that can still be called off (not yet in the hands of the publisher). */
const CANCELLABLE = ["SCHEDULED", "QUEUED"] as const;

/**
 * Cancels the open publications of a variant: the effect of un-approving it, editing it after
 * approval, or cancelling its schedule (10 §10.4.3 rows 13 and 18). Returns the ids.
 */
export async function cancelOpenPublications(
  ctx: ServiceContext,
  variantId: string,
  cause: string,
): Promise<string[]> {
  const cancelled = await ctx.db
    .update(schema.publications)
    .set({
      status: "CANCELLED",
      cancelledAt: ctx.clock.now(),
      cancelledBy: ctx.actor.type === "USER" ? ctx.actor.userId : null,
    })
    .where(
      and(
        eq(schema.publications.contentVariantId, variantId),
        inArray(schema.publications.status, [...CANCELLABLE]),
      ),
    )
    .returning({ id: schema.publications.id, marketId: schema.publications.marketId });
  for (const p of cancelled) {
    await audit(ctx, {
      action: "publication.cancelled",
      entityType: "publication",
      entityId: p.id,
      marketId: p.marketId,
      data: { variantId, cause },
    });
  }
  return cancelled.map((p) => p.id);
}

/**
 * Moves a variant along the state machine (plan 10 §10.4.3): checks the event is allowed from the
 * current status, changes the status through the shared `transition` helper (one audit event),
 * bumps `lock_version` and `status_changed_at`, and runs the side effects the machine lists that
 * belong to this layer: cancel the open publication and clear the approval when an approved
 * variant goes back to review. Review events, snapshots, campaign ids and publications are
 * written by the services that own those events (edit, approve, schedule). Events that keep the
 * status (an edit while in review) are not transitions: use `assertTransition` for those.
 */
export async function transitionVariant(
  ctx: ServiceContext,
  input: TransitionVariantInput,
): Promise<Variant> {
  const { variantId, event } = input;
  return withTransaction(ctx, async (tx) => {
    const [current] = await tx.db
      .select({ status: schema.contentVariants.status, marketId: schema.contentVariants.marketId })
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variantId));
    if (!current) throw new NotFoundError("Variant not found.", { details: { variantId } });
    const row = assertTransition(current.status, event);
    if (row.to === current.status) {
      throw new Error(`${event} does not change the status of a ${current.status} variant.`);
    }

    if (row.effects.includes("CANCEL_PUBLICATION")) {
      await cancelOpenPublications(tx, variantId, event);
    }
    return transition(tx, {
      table: schema.contentVariants,
      id: variantId,
      from: [current.status],
      to: row.to,
      set: {
        ...input.set,
        ...(row.effects.includes("CLEAR_APPROVAL") ? { approvedVersionId: null } : {}),
        lockVersion: sql`${schema.contentVariants.lockVersion} + 1`,
        statusChangedAt: tx.clock.now(),
      },
      audit: {
        action: row.audit,
        entityType: "content_variant",
        marketId: current.marketId,
        data: { event, ...(input.reason ? { reason: input.reason } : {}), ...input.data },
      },
    });
  });
}
