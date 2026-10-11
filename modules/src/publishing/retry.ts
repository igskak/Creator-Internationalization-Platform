import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { ConflictError, InvalidStateError, NotFoundError } from "@rc/lib/errors";
import { z } from "zod";
import { transitionVariant } from "../content";
import { audit, type ServiceContext, withTransaction } from "../core";
import { startPublishJobSafely } from "./queue";
import { assertReadyToPublish, GuardFailure } from "./safeguards";

type Publication = typeof schema.publications.$inferSelect;

export const RetryPublicationInput = z.object({ publicationId: z.uuid() });

/**
 * Tries a FAILED publication again (plan 05 §5.8, M5-07): the environment and the account are
 * checked now, the retry number goes up and with it the idempotency key (`pub:{id}:{n}`), the
 * attempt budget starts over, and the draft goes back to PUBLISHING. The containers already made
 * and the step are kept: the machine resumes there, reconciles an unknown `media_publish` first,
 * and makes containers again only if Meta says they expired. The job is started after the commit.
 */
export async function retryPublication(
  ctx: ServiceContext,
  raw: z.input<typeof RetryPublicationInput>,
): Promise<Publication> {
  const { publicationId } = RetryPublicationInput.parse(raw);
  const retried = await withTransaction(ctx, async (tx) => {
    const [current] = await tx.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.id, publicationId))
      .for("update");
    if (!current) throw new NotFoundError("Publication not found.", { details: { publicationId } });
    if (current.status !== "FAILED") {
      throw new InvalidStateError(
        `Only a failed post can be retried, this one is ${current.status}.`,
        {
          details: { status: current.status },
        },
      );
    }
    let account: Awaited<ReturnType<typeof assertReadyToPublish>>;
    try {
      account = await assertReadyToPublish(tx, current.marketId, current.dryRun);
    } catch (error) {
      if (error instanceof GuardFailure) {
        throw new InvalidStateError(error.message, { details: { guard: error.code } });
      }
      throw error;
    }
    const retryNo = current.retryNo + 1;
    // Containers belong to one account: a different account starts from the beginning.
    const sameAccount = current.socialAccountId === account.id;
    let row: Publication | undefined;
    try {
      [row] = await tx.db
        .update(schema.publications)
        .set({
          status: "QUEUED",
          retryNo,
          idempotencyKey: `pub:${current.id}:${retryNo}`,
          attemptCount: 0,
          lastError: null,
          triggerRunId: null,
          socialAccountId: account.id,
          ...(sameAccount
            ? {}
            : {
                step: "GUARDS",
                igChildrenContainerIds: [],
                igContainerId: null,
                igContainerStatus: null,
              }),
        })
        .where(eq(schema.publications.id, current.id))
        .returning();
    } catch (error) {
      if (String((error as Error).message).includes("publications_one_live_per_variant_uq")) {
        throw new ConflictError("This draft already has another post. Reload.");
      }
      throw error;
    }
    if (!row) throw new Error("Update returned no row.");
    if (!current.dryRun) {
      const [variant] = await tx.db
        .select({ status: schema.contentVariants.status })
        .from(schema.contentVariants)
        .where(eq(schema.contentVariants.id, current.contentVariantId));
      if (variant?.status === "FAILED") {
        await transitionVariant(tx, {
          variantId: current.contentVariantId,
          event: "RETRY",
          data: { publicationId: current.id, retryNo },
        });
      }
    }
    await audit(tx, {
      action: "publication.retried",
      entityType: "publication",
      entityId: current.id,
      marketId: current.marketId,
      data: { retryNo, previousError: current.lastError, step: current.step },
    });
    return row;
  });
  await startPublishJobSafely(ctx, retried);
  const [fresh] = await ctx.db
    .select()
    .from(schema.publications)
    .where(eq(schema.publications.id, retried.id));
  return fresh ?? retried;
}
