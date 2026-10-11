import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { type ServiceContext, triggerJob } from "../core";

type Publication = typeof schema.publications.$inferSelect;

/**
 * Starts the publish job (J10) for a QUEUED publication and records the run id. The Trigger.dev
 * idempotency key is the publication's own, so triggering twice starts one run; one queue slot per
 * Instagram account (`concurrencyKey`, plan 06 §6.1). `recoveryTag` makes a fresh key for a run
 * that has to replace a dead one (the old key stays taken by a run that already ended).
 */
export async function startPublishJob(
  ctx: ServiceContext,
  publication: Pick<Publication, "id" | "idempotencyKey" | "socialAccountId" | "marketId">,
  options: { recoveryTag?: string } = {},
): Promise<{ runId: string }> {
  const { runId } = await triggerJob(
    ctx,
    "publish-content",
    { publicationId: publication.id },
    {
      idempotencyKey: options.recoveryTag
        ? `${publication.idempotencyKey}:recover:${options.recoveryTag}`
        : publication.idempotencyKey,
      concurrencyKey: publication.socialAccountId ?? publication.marketId,
      tags: [`publication:${publication.id}`],
    },
  );
  await ctx.db
    .update(schema.publications)
    .set({ triggerRunId: runId })
    .where(eq(schema.publications.id, publication.id));
  return { runId };
}

/**
 * The same, for the places that have just committed a QUEUED publication: if the job runner is
 * down the publication is not lost, the dispatcher finds it as an orphan within minutes.
 */
export async function startPublishJobSafely(
  ctx: ServiceContext,
  publication: Parameters<typeof startPublishJob>[1],
): Promise<void> {
  try {
    await startPublishJob(ctx, publication);
  } catch (error) {
    ctx.logger.error(
      { err: error, publicationId: publication.id },
      "could not start the publish job; the dispatcher will pick it up",
    );
  }
}
