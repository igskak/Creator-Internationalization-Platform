import "server-only";
import * as Sentry from "@sentry/nextjs";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "../auth/session";
import { currentRequestId, requestContext } from "../context";
import { serverLogger } from "../runtime";
import { type ActionDefinition, type ActionDeps, runAction } from "./run-action";

const deps: ActionDeps = {
  requestId: currentRequestId,
  currentUser: async () => {
    const current = await getCurrentUser();
    return current.status === "signed-in" ? current.user : null;
  },
  makeContext: (user, requestId) =>
    requestContext({ type: "USER", userId: user.id, role: user.role }, requestId),
  logger: serverLogger,
  rethrow: unstable_rethrow,
  report: (error, { action, requestId }) =>
    Sentry.captureException(error, { tags: { action, request_id: requestId } }),
};

/**
 * A server action (plan 05 §5.1). Export the result from a `"use server"` file in
 * `src/server/actions/<area>.ts`:
 *
 *   export const approveVariant = defineAction({
 *     name: "approveVariant",
 *     input: ApproveVariantInput,
 *     roles: ["owner", "editor", "chef"],
 *     handler: (ctx, input) => content.approveVariant(ctx, input),
 *   });
 */
export function defineAction<S extends z.ZodType, T>(
  definition: ActionDefinition<S, T>,
): (input: z.input<S>) => Promise<ActionResult<T>> {
  return async (input) => runAction(definition, input, deps);
}
