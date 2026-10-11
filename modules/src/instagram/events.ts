import { schema } from "@rc/db";
import { and, eq, inArray, isNull } from "@rc/db/orm";
import type { ServiceContext } from "../core";

// `integration_events` (04 §4.3): findings about an external service that a person should see.
// An open finding of the same code for the same account is not repeated; it is resolved when the
// cause is gone (a refresh worked, a health check passed, the account was reconnected).

export type IntegrationEventInput = {
  integration?: "instagram" | "anthropic" | "openai" | "r2" | "trigger";
  socialAccountId?: string;
  severity: "INFO" | "WARN" | "ERROR";
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

/** Records a finding unless the same one is still open. Returns true when a row was added. */
export async function recordIntegrationEvent(
  ctx: ServiceContext,
  event: IntegrationEventInput,
): Promise<boolean> {
  const integration = event.integration ?? "instagram";
  const open = await ctx.db
    .select({ id: schema.integrationEvents.id })
    .from(schema.integrationEvents)
    .where(
      and(
        eq(schema.integrationEvents.integration, integration),
        eq(schema.integrationEvents.code, event.code),
        isNull(schema.integrationEvents.resolvedAt),
        event.socialAccountId
          ? eq(schema.integrationEvents.socialAccountId, event.socialAccountId)
          : isNull(schema.integrationEvents.socialAccountId),
      ),
    );
  if (open.length > 0) return false;
  await ctx.db.insert(schema.integrationEvents).values({
    integration,
    socialAccountId: event.socialAccountId ?? null,
    severity: event.severity,
    code: event.code,
    message: event.message,
    details: event.details ?? null,
    occurredAt: ctx.clock.now(),
  });
  return true;
}

/** Closes the open findings of an account with these codes. */
export async function resolveIntegrationEvents(
  ctx: ServiceContext,
  socialAccountId: string,
  codes: readonly string[],
): Promise<void> {
  if (codes.length === 0) return;
  await ctx.db
    .update(schema.integrationEvents)
    .set({ resolvedAt: ctx.clock.now() })
    .where(
      and(
        eq(schema.integrationEvents.socialAccountId, socialAccountId),
        inArray(schema.integrationEvents.code, [...codes]),
        isNull(schema.integrationEvents.resolvedAt),
      ),
    );
}
