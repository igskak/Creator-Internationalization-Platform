import { schema } from "@rc/db";
import { redact } from "@rc/lib/logging";
import type { ServiceContext } from "./context";

export type AuditEvent = {
  /** e.g. 'source.uploaded', 'variant.approved', 'settings.changed'. */
  action: string;
  entityType: string;
  entityId?: string;
  marketId?: string;
  /** Redacted before it is stored; never put tokens here. */
  data?: Record<string, unknown>;
};

/** Appends one audit_events row with actor, time and request id from the context. Returns its id. */
export async function audit(ctx: ServiceContext, event: AuditEvent): Promise<number> {
  const { actor } = ctx;
  const [row] = await ctx.db
    .insert(schema.auditEvents)
    .values({
      occurredAt: ctx.clock.now(),
      actorType: actor.type,
      actorUserId: actor.type === "USER" ? actor.userId : null,
      jobRunId: actor.type === "JOB" ? actor.jobRunId : null,
      requestId: ctx.requestId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      marketId: event.marketId ?? null,
      data: redact(event.data ?? {}) as Record<string, unknown>,
    })
    .returning({ id: schema.auditEvents.id });
  if (!row) throw new Error("audit: insert returned no row");
  return row.id;
}
