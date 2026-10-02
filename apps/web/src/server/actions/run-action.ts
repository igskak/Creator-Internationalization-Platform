import { isAppError, toPublicError, UnauthenticatedError, ValidationError } from "@rc/lib/errors";
import type { Logger } from "@rc/lib/logging";
import { type AppUser, requireRole, type ServiceContext, type UserRole } from "@rc/modules/core";
import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";

// The action pipeline without Next.js, so it can be unit-tested. `_define.ts` wires the real
// session, context and logger.

export type ActionDefinition<S extends z.ZodType, T> = {
  /** Logged with every failure. */
  name: string;
  input: S;
  /** Default: any active user. */
  roles?: readonly UserRole[];
  /** One service call; no business logic here. */
  handler: (ctx: ServiceContext, input: z.output<S>) => Promise<T>;
};

export type ActionDeps = {
  requestId: () => Promise<string>;
  /** The allowlisted user, or null when signed out or refused. */
  currentUser: () => Promise<AppUser | null>;
  makeContext: (user: AppUser, requestId: string) => Promise<ServiceContext>;
  logger: () => Logger;
  /** Lets framework control flow (redirect, notFound) pass through instead of becoming INTERNAL. */
  rethrow?: (error: unknown) => void;
  /** Error tracking for unexpected errors (Sentry in production, M0-19). */
  report?: (error: unknown, context: { action: string; requestId: string }) => void;
};

/**
 * Validate input → load the user → check the role → build the context → call the handler →
 * map errors to ActionResult. Unknown errors become INTERNAL and are logged with the request id.
 */
export async function runAction<S extends z.ZodType, T>(
  definition: ActionDefinition<S, T>,
  rawInput: unknown,
  deps: ActionDeps,
): Promise<ActionResult<T>> {
  const requestId = await deps.requestId();
  try {
    const parsed = definition.input.safeParse(rawInput);
    if (!parsed.success) throw ValidationError.fromZod(parsed.error);
    const user = await deps.currentUser();
    if (!user) throw new UnauthenticatedError();
    if (definition.roles) requireRole(user, definition.roles);
    const ctx = await deps.makeContext(user, requestId);
    return { ok: true, data: await definition.handler(ctx, parsed.data) };
  } catch (error) {
    deps.rethrow?.(error);
    const log = deps.logger().child({ action: definition.name, requestId });
    if (!isAppError(error)) {
      log.error({ err: error }, "action failed");
      deps.report?.(error, { action: definition.name, requestId });
    } else if (error.exposeMessage) {
      log.info({ err: error, code: error.code }, "action refused");
    } else {
      log.warn({ err: error, code: error.code }, "action failed on an external service");
    }
    return { ok: false, error: { ...toPublicError(error), requestId } };
  }
}
