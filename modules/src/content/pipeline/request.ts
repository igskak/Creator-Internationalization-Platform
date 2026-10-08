import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import { and, eq, inArray, ne } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, triggerJob } from "../../core";

// The `generateVariants` and `regenerateVariant` actions (plan 05 §5.6, §5.7) and the payload of
// J5 `generate-content` (plan 06 §6.2, M2-14). The actions validate, make the DRAFT variants and
// queue the job; the job runs the pipeline of M2-13 and moves each variant to READY_FOR_REVIEW.

export const MAX_VARIANTS_PER_RUN = 10;

/** J5 payload. */
export const GenerateContentPayload = z.object({
  masterIdeaId: z.uuid(),
  variantIds: z.array(z.uuid()).min(1).max(MAX_VARIANTS_PER_RUN),
  /** Identifies the run: the same id resumes it. */
  pipelineRunId: z.string().min(1).max(100),
  instruction: z.string().trim().max(500).optional(),
});
export type GenerateContentPayload = z.infer<typeof GenerateContentPayload>;

export const GenerateVariantsInput = z.object({
  masterIdeaId: z.uuid(),
  /** Default: every active market. */
  marketIds: z.array(z.uuid()).min(1).max(MAX_VARIANTS_PER_RUN).optional(),
});

export const RegenerateVariantInput = z.object({
  variantId: z.uuid(),
  instruction: z.string().trim().max(500).optional(),
  /** Taxonomy `reason_code`: why the draft is being redone. */
  reasonCode: z.string().trim().min(1).max(60),
});

const parse = <S extends z.ZodType>(input: S, raw: unknown): z.output<S> => {
  const parsed = input.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
};

export type VariantsRequest = {
  variantIds: string[];
  jobRunId: string;
  pipelineRunId: string;
};

const queue = async (
  ctx: ServiceContext,
  payload: GenerateContentPayload,
): Promise<{ jobRunId: string }> => {
  const { runId } = await triggerJob(ctx, "generate-content", payload, {
    idempotencyKey: `gen:${payload.pipelineRunId}`,
  });
  return { jobRunId: runId };
};

/**
 * Makes a DRAFT variant for each market that has none and queues the pipeline for them. The idea
 * must be ACCEPTED and the markets active. A market that already has a live variant is refused
 * unless that variant is still a DRAFT (a failed one is retried): a variant that has been
 * generated is redone with `regenerateVariant`, which keeps the person's reason.
 */
export async function requestVariants(
  ctx: ServiceContext,
  raw: z.input<typeof GenerateVariantsInput>,
): Promise<VariantsRequest> {
  const { masterIdeaId, marketIds } = parse(GenerateVariantsInput, raw);
  const [idea] = await ctx.db
    .select({ id: schema.masterIdeas.id, status: schema.masterIdeas.status })
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, masterIdeaId));
  if (!idea) throw new NotFoundError("Idea not found.", { details: { masterIdeaId } });
  if (idea.status !== "ACCEPTED") {
    throw new InvalidStateError(`Accept the idea first: it is ${idea.status}.`, {
      details: { masterIdeaId, status: idea.status },
    });
  }

  const active = await ctx.db
    .select({ id: schema.markets.id, code: schema.markets.code })
    .from(schema.markets)
    .where(eq(schema.markets.isActive, true));
  const markets = marketIds ? active.filter((m) => marketIds.includes(m.id)) : active;
  const unknown = (marketIds ?? []).filter((id) => !active.some((m) => m.id === id));
  if (unknown.length > 0) {
    throw new ValidationError("Some markets do not exist or are not active.", {
      fieldErrors: { marketIds: ["Some markets do not exist or are not active."] },
    });
  }
  if (markets.length === 0) {
    throw new InvalidStateError("There is no active market to write for.");
  }

  const live = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(
      and(
        eq(schema.contentVariants.masterIdeaId, masterIdeaId),
        ne(schema.contentVariants.status, "REJECTED"),
        inArray(
          schema.contentVariants.marketId,
          markets.map((m) => m.id),
        ),
      ),
    );
  const blocked = live.filter((v) => v.status !== "DRAFT");
  if (blocked.length > 0) {
    throw new InvalidStateError(
      "Some markets already have drafts. Redo a draft with Regenerate instead.",
      { details: { variants: blocked.map((v) => ({ id: v.id, status: v.status })) } },
    );
  }

  const variantIds: string[] = [];
  for (const market of markets) {
    const existing = live.find((v) => v.marketId === market.id);
    if (existing) {
      variantIds.push(existing.id);
      continue;
    }
    const [created] = await ctx.db
      .insert(schema.contentVariants)
      .values({ masterIdeaId, marketId: market.id })
      .returning({ id: schema.contentVariants.id });
    if (!created) throw new Error("Insert returned no row.");
    variantIds.push(created.id);
  }

  const pipelineRunId = randomUUID();
  await audit(ctx, {
    action: "variants.requested",
    entityType: "master_idea",
    entityId: masterIdeaId,
    data: { pipelineRunId, markets: markets.map((m) => m.code), variantIds },
  });
  const { jobRunId } = await queue(ctx, { masterIdeaId, variantIds, pipelineRunId });
  return { variantIds, jobRunId, pipelineRunId };
}

/**
 * Redoes the whole pipeline for one market's variant (plan 05 §5.7); its sibling stays as a
 * constraint. DRAFT, READY_FOR_REVIEW and CHANGES_REQUESTED variants only: an approved or
 * scheduled one is un-approved first. The reason must be a taxonomy `reason_code`.
 */
export async function requestVariantRegeneration(
  ctx: ServiceContext,
  raw: z.input<typeof RegenerateVariantInput>,
): Promise<{ jobRunId: string; pipelineRunId: string }> {
  const { variantId, instruction, reasonCode } = parse(RegenerateVariantInput, raw);
  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { variantId } });
  if (!["DRAFT", "READY_FOR_REVIEW", "CHANGES_REQUESTED"].includes(variant.status)) {
    throw new InvalidStateError(`A ${variant.status} variant cannot be regenerated.`, {
      details: { variantId, status: variant.status },
    });
  }
  const [reason] = await ctx.db
    .select({ code: schema.taxonomyTerms.code })
    .from(schema.taxonomyTerms)
    .where(
      and(
        eq(schema.taxonomyTerms.kind, "reason_code"),
        eq(schema.taxonomyTerms.code, reasonCode),
        eq(schema.taxonomyTerms.isActive, true),
      ),
    );
  if (!reason) {
    throw new ValidationError(`"${reasonCode}" is not a reason code.`, {
      fieldErrors: { reasonCode: [`"${reasonCode}" is not a reason code.`] },
    });
  }
  const [idea] = await ctx.db
    .select({ status: schema.masterIdeas.status })
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, variant.masterIdeaId));
  if (idea?.status !== "ACCEPTED") {
    throw new InvalidStateError(`The idea is ${idea?.status ?? "missing"}, not ACCEPTED.`);
  }

  const pipelineRunId = randomUUID();
  await audit(ctx, {
    action: "variant.regeneration_requested",
    entityType: "content_variant",
    entityId: variantId,
    marketId: variant.marketId,
    data: { pipelineRunId, reasonCode, hasInstruction: Boolean(instruction) },
  });
  const { jobRunId } = await queue(ctx, {
    masterIdeaId: variant.masterIdeaId,
    variantIds: [variantId],
    pipelineRunId,
    ...(instruction ? { instruction } : {}),
  });
  return { jobRunId, pipelineRunId };
}
