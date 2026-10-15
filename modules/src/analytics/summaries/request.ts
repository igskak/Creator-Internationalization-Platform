import { randomUUID } from "node:crypto";
import { ForbiddenError } from "@rc/lib/errors";
import type { z } from "zod";
import { audit, type ServiceContext, triggerJob } from "../../core";
import { BuildSummariesPayload } from "./build";

// The "Build now" button of the Learning summary (plan 05 §5.10 buildPerformanceSummary, M7-03):
// starts J15 for every market and the summary across them. A click is its own run: the cron's
// idempotency key is per day, a person may want a second build after new numbers came in.

export const RequestSummaryInput = BuildSummariesPayload;

export async function requestPerformanceSummary(
  ctx: ServiceContext,
  raw: z.input<typeof RequestSummaryInput>,
): Promise<{ runId: string }> {
  if (ctx.actor.type === "USER" && ctx.actor.role === "chef") throw new ForbiddenError();
  const input = RequestSummaryInput.parse(raw);
  const requestId = randomUUID();
  const { runId } = await triggerJob(ctx, "build-performance-summary", input, {
    idempotencyKey: `summary:${input.marketId === undefined ? "all" : (input.marketId ?? "cross")}:${requestId}`,
  });
  await audit(ctx, {
    action: "learning.summary_requested",
    entityType: "performance_summary",
    data: { windowDays: input.windowDays, marketId: input.marketId ?? null, runId },
  });
  return { runId };
}
