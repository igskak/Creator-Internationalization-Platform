import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import { and, desc, eq, inArray, sql } from "@rc/db/orm";
import { NotFoundError, TransientError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, triggerJob, withTransaction } from "../../core";
import { generateIdeaDrafts } from "./generate";
import { COMMERCIAL_INTENTS } from "./shared";

// J4 `generate-ideas` (plan 06 §6.2) and the `generateIdeas` action (plan 05 §5.6). The action only
// validates and queues; the job asks the model and stores PROPOSED ideas with their card links.
// The outcome of a request is an audit event keyed by `requestId`, which makes the job safe to
// run again and lets the screen see "done" or "failed" without the Trigger.dev dashboard.

export const MAX_IDEAS_PER_REQUEST = 10;

const codes = z.array(z.string().trim().min(1).max(100)).max(20);

export const IdeaFocus = z.object({
  categories: codes.optional(),
  angles: codes.optional(),
  productId: z.uuid().optional(),
  commercialIntent: z.enum(COMMERCIAL_INTENTS).optional(),
});
export type IdeaFocus = z.infer<typeof IdeaFocus>;

export const GenerateIdeasInput = z.object({
  count: z.number().int().min(1).max(MAX_IDEAS_PER_REQUEST),
  focus: IdeaFocus.optional(),
  note: z.string().trim().max(500).optional(),
});

/** J4 payload. */
export const GenerateIdeasPayload = GenerateIdeasInput.extend({ requestId: z.uuid() });

export const REQUESTED = "ideas.requested";
export const GENERATED = "ideas.generated";

/** Queues idea generation. Category and angle codes must be active; a product must exist. */
export async function generateIdeas(
  ctx: ServiceContext,
  raw: z.input<typeof GenerateIdeasInput>,
): Promise<{ jobRunId: string; requestId: string }> {
  const parsed = GenerateIdeasInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { count, focus, note } = parsed.data;

  for (const [kind, list] of [
    ["category", focus?.categories],
    ["angle", focus?.angles],
  ] as const) {
    if (!list?.length) continue;
    const active = await ctx.db
      .select({ code: schema.taxonomyTerms.code })
      .from(schema.taxonomyTerms)
      .where(
        and(
          eq(schema.taxonomyTerms.kind, kind),
          eq(schema.taxonomyTerms.isActive, true),
          inArray(schema.taxonomyTerms.code, list),
        ),
      );
    const unknown = list.filter((code) => !active.some((a) => a.code === code));
    if (unknown.length > 0) {
      const message = `Unknown ${kind}: ${unknown.join(", ")}.`;
      throw new ValidationError(message, { fieldErrors: { [`focus.${kind}`]: [message] } });
    }
  }
  if (focus?.productId) {
    const [product] = await ctx.db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, focus.productId));
    if (!product) {
      throw new ValidationError("This product does not exist.", {
        fieldErrors: { "focus.productId": ["This product does not exist."] },
      });
    }
  }

  const requestId = randomUUID();
  await audit(ctx, {
    action: REQUESTED,
    entityType: "ideas_request",
    entityId: requestId,
    data: { requestId, count, hasFocus: Boolean(focus), hasNote: Boolean(note) },
  });
  const { runId } = await triggerJob(
    ctx,
    "generate-ideas",
    { requestId, count, ...(focus ? { focus } : {}), ...(note ? { note } : {}) },
    { idempotencyKey: `ideas:${requestId}` },
  );
  return { jobRunId: runId, requestId };
}

export type IdeasRequestOutcome = {
  requestId: string;
  outcome: "OK" | "FAILED";
  /** Ids of the PROPOSED ideas that were stored. */
  created: string[];
  /** Ideas left out as repeats of recent ideas. */
  dropped: number;
  /** Ideas not stored because a card changed while the model worked. */
  skipped: number;
  /** Why a failed request failed. */
  reason?: string;
  runIds: string[];
  costUsd: number | null;
};

async function findOutcome(ctx: ServiceContext, requestId: string) {
  const [row] = await ctx.db
    .select({ data: schema.auditEvents.data })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.action, GENERATED),
        sql`${schema.auditEvents.data}->>'requestId' = ${requestId}`,
      ),
    )
    .orderBy(desc(schema.auditEvents.id))
    .limit(1);
  return row ? (row.data as IdeasRequestOutcome) : undefined;
}

/**
 * State of a request for the screen: PENDING until the job has written its outcome, then DONE
 * (ideas stored, maybe none) or FAILED with the reason. NotFoundError for an unknown request id.
 */
export async function getIdeasRequestStatus(
  ctx: ServiceContext,
  requestId: string,
): Promise<{ state: "PENDING" } | { state: "DONE" | "FAILED"; outcome: IdeasRequestOutcome }> {
  const outcome = await findOutcome(ctx, requestId);
  if (outcome) return { state: outcome.outcome === "OK" ? "DONE" : "FAILED", outcome };
  const [requested] = await ctx.db
    .select({ id: schema.auditEvents.id })
    .from(schema.auditEvents)
    .where(
      and(eq(schema.auditEvents.action, REQUESTED), eq(schema.auditEvents.entityId, requestId)),
    )
    .limit(1);
  if (!requested) throw new NotFoundError("Unknown ideas request.", { details: { requestId } });
  return { state: "PENDING" };
}

/** The editor's focus as one line of text for the prompt. */
async function focusText(
  ctx: ServiceContext,
  focus: IdeaFocus | undefined,
  note: string | undefined,
): Promise<string | undefined> {
  const parts: string[] = [];
  if (focus?.categories?.length) parts.push(`Categories: ${focus.categories.join(", ")}`);
  if (focus?.angles?.length) parts.push(`Angles: ${focus.angles.join(", ")}`);
  if (focus?.productId) {
    const [product] = await ctx.db
      .select({ code: schema.products.code, name: schema.products.name })
      .from(schema.products)
      .where(eq(schema.products.id, focus.productId));
    if (product) parts.push(`Feature the product ${product.code} (${product.name})`);
  }
  if (focus?.commercialIntent && focus.commercialIntent !== "NONE") {
    parts.push(`Commercial intent: ${focus.commercialIntent}`);
  }
  if (note) parts.push(`Note: ${note}`);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

/**
 * J4 handler. Writes one `ideas.generated` audit event with the outcome, in the same transaction
 * as the ideas, so a second run with the same request id returns that outcome and changes nothing.
 * A model that could not answer usably, or no approved cards, is a FAILED outcome (retrying would
 * not help); transient errors are rethrown for Trigger.dev to retry.
 */
export async function runGenerateIdeas(
  ctx: ServiceContext,
  payload: z.output<typeof GenerateIdeasPayload>,
): Promise<IdeasRequestOutcome> {
  const { requestId } = payload;
  const done = await findOutcome(ctx, requestId);
  if (done) return done;

  const record = async (
    outcome: IdeasRequestOutcome,
    executor: ServiceContext = ctx,
  ): Promise<IdeasRequestOutcome> => {
    await audit(executor, {
      action: GENERATED,
      entityType: "ideas_request",
      entityId: requestId,
      data: outcome,
    });
    return outcome;
  };
  const failed = (reason: string, extra: Partial<IdeasRequestOutcome> = {}) =>
    record({
      requestId,
      outcome: "FAILED",
      created: [],
      dropped: 0,
      skipped: 0,
      reason,
      runIds: [],
      costUsd: null,
      ...extra,
    });

  let result: Awaited<ReturnType<typeof generateIdeaDrafts>>;
  try {
    const focus = await focusText(ctx, payload.focus, payload.note);
    result = await generateIdeaDrafts(ctx, {
      count: payload.count,
      ...(focus ? { focus } : {}),
      ...(payload.focus?.categories?.length ? { categories: payload.focus.categories } : {}),
    });
  } catch (error) {
    if (error instanceof TransientError) throw error;
    if (error instanceof Error && "code" in error) return failed(error.message);
    throw error;
  }
  const runInfo = { runIds: result.runIds, costUsd: result.costUsd };
  if (result.status === "INVALID_OUTPUT" || result.status === "REFUSED") {
    return failed(
      result.status === "REFUSED"
        ? "The model declined to answer."
        : `The model's answer failed the checks: ${result.issues.map((i) => i.code).join(", ")}.`,
      runInfo,
    );
  }

  const productByCode = new Map(
    (
      await ctx.db
        .select({ id: schema.products.id, code: schema.products.code })
        .from(schema.products)
    ).map((p) => [p.code, p.id]),
  );
  const brandId = (await ctx.db.select({ id: schema.brands.id }).from(schema.brands).limit(1))[0]
    ?.id;
  if (!brandId) return failed("No brand is set up.", runInfo);

  return withTransaction(ctx, async (tx) => {
    const created: string[] = [];
    let skipped = 0;
    for (const draft of result.ideas) {
      const linked = [...draft.primaryKnowledgeIds, ...draft.supportingKnowledgeIds];
      // A card may have been edited or archived while the model worked: that idea is not stored.
      const cards = await tx.db
        .select({
          id: schema.knowledgeItems.id,
          status: schema.knowledgeItems.reviewStatus,
          approvedVersion: schema.knowledgeItems.approvedVersion,
        })
        .from(schema.knowledgeItems)
        .where(inArray(schema.knowledgeItems.id, linked));
      const current = new Map(cards.map((c) => [c.id, c]));
      const stale = linked.some((id) => {
        const card = current.get(id);
        return (
          card?.status !== "CHEF_APPROVED" ||
          card.approvedVersion !== result.context.cardVersions[id]
        );
      });
      if (stale) {
        skipped += 1;
        continue;
      }
      const [row] = await tx.db
        .insert(schema.masterIdeas)
        .values({
          brandId,
          topic: draft.topic,
          category: draft.category,
          angle: draft.angle,
          coreMessage: draft.coreMessage,
          evidenceSummary: draft.rationale,
          recommendedFormat: draft.recommendedFormat,
          commercialIntent: draft.commercialIntent,
          productId: draft.productCode ? (productByCode.get(draft.productCode) ?? null) : null,
          origin: "AI_GENERATED",
          rationale: `Why now: ${draft.whyNow}\nDifferent from recent: ${draft.differsFromRecent}`,
          generationRunId: result.runIds.at(-1) ?? null,
        })
        .returning({ id: schema.masterIdeas.id });
      if (!row) continue;
      await tx.db.insert(schema.masterIdeaKnowledge).values([
        ...draft.primaryKnowledgeIds.map((id) => ({
          masterIdeaId: row.id,
          knowledgeItemId: id,
          knowledgeVersion: result.context.cardVersions[id] ?? 1,
          role: "PRIMARY" as const,
        })),
        ...draft.supportingKnowledgeIds.map((id) => ({
          masterIdeaId: row.id,
          knowledgeItemId: id,
          knowledgeVersion: result.context.cardVersions[id] ?? 1,
          role: "SUPPORTING" as const,
        })),
      ]);
      await audit(tx, {
        action: "idea.created",
        entityType: "master_idea",
        entityId: row.id,
        data: { origin: "AI_GENERATED", requestId, runId: result.runIds.at(-1) },
      });
      created.push(row.id);
    }
    // Inside the transaction: the outcome and the ideas are stored together or not at all.
    return record(
      {
        requestId,
        outcome: "OK",
        created,
        dropped: result.dropped.length,
        skipped,
        ...runInfo,
      },
      tx,
    );
  });
}
