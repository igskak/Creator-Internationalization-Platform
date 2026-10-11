import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { type ServiceContext, withTransaction } from "../../core";
import { assertReasonCode } from "./reason";
import { assertTransition, type VariantEvent } from "./state";
import { transitionVariant } from "./transition";

type Variant = typeof schema.contentVariants.$inferSelect;

// The other decisions of a reviewer (plan 05 §5.7, 10 §10.4.3, M4-06): request changes, resubmit,
// reject (terminal) and un-approve. Each moves the variant through the state machine and records
// a review event with the reviewer, the reason and the lock version it was made against.

const ReasonCode = z.string().trim().min(1, "Choose a reason.").max(60);
const Reason = (message: string) => z.string().trim().min(1, message).max(1000);

export const RequestChangesInput = z.object({
  variantId: z.uuid(),
  reasonCode: ReasonCode,
  /** What should change; the writer's rewrite and the reviewer's colleagues read it. */
  reason: Reason("Say what should change."),
});
export const ResubmitVariantInput = z.object({ variantId: z.uuid() });
export const RejectVariantInput = z.object({
  variantId: z.uuid(),
  reasonCode: ReasonCode,
  reason: z.string().trim().max(1000).optional(),
});
export const UnapproveVariantInput = z.object({
  variantId: z.uuid(),
  reason: Reason("Say why the approval is withdrawn."),
});

const parse = <S extends z.ZodType>(schemaOf: S, raw: unknown): z.output<S> => {
  const parsed = schemaOf.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
};

async function decide(
  ctx: ServiceContext,
  input: {
    variantId: string;
    event: VariantEvent;
    action: (typeof schema.reviewEvents.$inferInsert)["action"];
    reasonCode?: string | undefined;
    reason?: string | undefined;
  },
): Promise<Variant> {
  const [variant] = await ctx.db
    .select({ status: schema.contentVariants.status })
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, input.variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { id: input.variantId } });
  assertTransition(variant.status, input.event);
  if (input.reasonCode) await assertReasonCode(ctx, input.reasonCode);

  return withTransaction(ctx, async (tx) => {
    const updated = await transitionVariant(tx, {
      variantId: input.variantId,
      event: input.event,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.reasonCode ? { data: { reasonCode: input.reasonCode } } : {}),
    });
    await tx.db.insert(schema.reviewEvents).values({
      contentVariantId: input.variantId,
      action: input.action,
      reviewerId: ctx.actor.type === "USER" ? ctx.actor.userId : null,
      reasonCode: input.reasonCode ?? null,
      reason: input.reason ?? null,
      // The version the decision found (the transition has bumped it since).
      variantLockVersion: updated.lockVersion - 1,
    });
    return updated;
  });
}

/** READY_FOR_REVIEW → CHANGES_REQUESTED, with a reason code and what should change. */
export async function requestChanges(
  ctx: ServiceContext,
  raw: z.input<typeof RequestChangesInput>,
): Promise<Variant> {
  const input = parse(RequestChangesInput, raw);
  return decide(ctx, { ...input, event: "REQUEST_CHANGES", action: "REQUEST_CHANGES" });
}

/** CHANGES_REQUESTED → READY_FOR_REVIEW. */
export async function resubmitVariant(
  ctx: ServiceContext,
  raw: z.input<typeof ResubmitVariantInput>,
): Promise<Variant> {
  const input = parse(ResubmitVariantInput, raw);
  return decide(ctx, { variantId: input.variantId, event: "RESUBMIT", action: "RESUBMIT" });
}

/**
 * READY_FOR_REVIEW or CHANGES_REQUESTED → REJECTED, which is final. The market may get a new
 * draft for the idea afterwards (a rejected variant no longer holds the slot).
 */
export async function rejectVariant(
  ctx: ServiceContext,
  raw: z.input<typeof RejectVariantInput>,
): Promise<Variant> {
  const input = parse(RejectVariantInput, raw);
  return decide(ctx, { ...input, event: "REJECT", action: "REJECT" });
}

/**
 * APPROVED, SCHEDULED or FAILED → READY_FOR_REVIEW: the approval is withdrawn, an open
 * publication is cancelled and the variant forgets its approved version (the version row stays).
 */
export async function unapproveVariant(
  ctx: ServiceContext,
  raw: z.input<typeof UnapproveVariantInput>,
): Promise<Variant> {
  const input = parse(UnapproveVariantInput, raw);
  return decide(ctx, { ...input, event: "UNAPPROVE", action: "UNAPPROVE" });
}
