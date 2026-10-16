import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import type { CtaSpec, Slide, ValidationIssue, VisualBrief } from "@rc/db/json";
import { eq, inArray } from "@rc/db/orm";
import {
  AppError,
  ConflictError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from "@rc/lib/errors";
import type { fieldRegenerator } from "@rc/prompts";
import { registry } from "@rc/templates";
import { z } from "zod";
import { runStage } from "../../ai";
import { audit, type ServiceContext, triggerJob } from "../../core";
import { loadPipelineContext } from "../pipeline/context";
import { gistOf, numericReference, type SiblingDraft, writerInput } from "../pipeline/inputs";
import {
  type ValidationContext,
  validateCitations,
  validateForbiddenPatterns,
  validateNumericFidelity,
  validateSlots,
  validateTextRules,
} from "../validation";
import { contentOf, toDraft } from "./content";
import { applyFieldChange, staleLockError } from "./edit";
import {
  formatFieldPath,
  isWithin,
  type ParsedFieldPath,
  parseFieldPath,
  readField,
  type VariantContent,
  writeField,
} from "./field-path";
import { assertReasonCode } from "./reason";
import { assertTransition } from "./state";

type Variant = typeof schema.contentVariants.$inferSelect;
type Output = fieldRegenerator.FieldRegeneratorOutput;

// Field regeneration (plan 05 §5.7 `regenerateVariantField`, 06 J6, 07 §7.6.1, M4-04): the model
// writes a new value for ONE field, the rest of the draft is context. The action checks and queues
// J6 `regenerate-field`; the job asks the model, checks the value like an edit, and records it as
// a REGENERATE review event with the old and the new value. Undo is an ordinary edit back.

export const MAX_INSTRUCTION_CHARS = 500;

export const RegenerateVariantFieldInput = z.object({
  variantId: z.uuid(),
  lockVersion: z.number().int().nonnegative(),
  field: z.string().min(1).max(200),
  instruction: z.string().trim().max(MAX_INSTRUCTION_CHARS).optional(),
  reasonCode: z.string().trim().min(1).max(60).optional(),
  /** Required when the variant is approved: the new value undoes the approval. */
  confirmed: z.boolean().optional(),
});
export type RegenerateVariantFieldInput = z.input<typeof RegenerateVariantFieldInput>;

/** J6 payload (06 §6.2). `requestId` identifies the request: the same one is one run. */
export const RegenerateFieldPayload = z.object({
  variantId: z.uuid(),
  field: z.string().min(1).max(200),
  instruction: z.string().max(MAX_INSTRUCTION_CHARS).optional(),
  reasonCode: z.string().max(60).optional(),
  lockVersion: z.number().int().nonnegative(),
  requestId: z.uuid(),
  /** The person who asked; the review event is theirs. */
  requestedBy: z.uuid().optional(),
  confirmed: z.boolean().optional(),
});
export type RegenerateFieldPayload = z.infer<typeof RegenerateFieldPayload>;

export type RegenerationOutcome =
  | { status: "APPLIED"; reviewEventId: string; runId: string; rationale: string }
  /** The model's value equals the current one. */
  | { status: "UNCHANGED"; runId: string }
  /** The draft changed while the model worked: the result was dropped. */
  | { status: "CONFLICT" }
  /** The variant is no longer in a state that takes the change. */
  | { status: "SKIPPED"; reason: string }
  /** The model gave no usable value. */
  | { status: "FAILED"; message: string; issues: ValidationIssue[] };

const parseInput = <S extends z.ZodType>(schemaOf: S, raw: unknown): z.output<S> => {
  const parsed = schemaOf.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
};

const kindOf = (field: ParsedFieldPath): fieldRegenerator.FieldKind => {
  if (field.kind === "visualBrief") {
    throw new ValidationError("The picture plan is redone with regenerateVisualBrief.", {
      fieldErrors: { field: ["The picture plan is redone with regenerateVisualBrief."] },
    });
  }
  return field.kind;
};

/** The picture plan of an image slot. */
function planOf(brief: VisualBrief | null, field: ParsedFieldPath) {
  if (field.kind !== "image") return undefined;
  return brief?.slides.find((p) => p.slideId === field.slideId && p.slot === field.slot);
}

/**
 * The `regenerateVariantField` action: checks that the field exists and that the variant can be
 * changed, and queues J6. Nothing is written yet; an approved variant needs `confirmed` because
 * the result will undo the approval.
 */
export async function requestFieldRegeneration(
  ctx: ServiceContext,
  raw: RegenerateVariantFieldInput,
): Promise<{ jobRunId: string; requestId: string }> {
  const input = parseInput(RegenerateVariantFieldInput, raw);
  const field = parseFieldPath(input.field);
  kindOf(field);
  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, input.variantId));
  if (!variant) throw new NotFoundError("Variant not found.", { details: { id: input.variantId } });
  const row = assertTransition(variant.status, "EDIT");
  if (variant.lockVersion !== input.lockVersion) throw await staleLockError(ctx, variant);
  if (row.to !== variant.status && !input.confirmed) {
    throw new InvalidStateError(
      `This ${variant.status} variant is approved: a new value undoes the approval and cancels its post.`,
      { details: { requiresConfirmation: true, status: variant.status } },
    );
  }
  if (variant.format === "REEL") {
    throw new InvalidStateError("A Reel's caption, ask and hashtags are edited by hand.", {
      details: { code: "reel_field" },
    });
  }
  const content = contentOf(variant);
  if (!content) throw new InvalidStateError("The variant has no draft to change yet.");
  readField(content, field); // a missing slide is refused here
  if (
    field.kind === "slot" &&
    !(field.slot in (content.slides.find((s) => s.id === field.slideId)?.slots ?? {}))
  ) {
    const template = registry.get(
      content.slides.find((s) => s.id === field.slideId)?.templateId ?? "",
    );
    if (!template?.textSlots[field.slot]) {
      throw new ValidationError(`There is no slot "${field.slot}" on that slide.`, {
        fieldErrors: { field: [`There is no slot "${field.slot}" on that slide.`] },
      });
    }
  }
  if (field.kind === "image" && !planOf(variant.visualBriefJson, field)) {
    throw new ValidationError("That image slot has no picture plan.", {
      fieldErrors: { field: ["That image slot has no picture plan."] },
    });
  }
  if (input.reasonCode) await assertReasonCode(ctx, input.reasonCode);

  const requestId = randomUUID();
  await audit(ctx, {
    action: "variant.field_regeneration_requested",
    entityType: "content_variant",
    entityId: variant.id,
    marketId: variant.marketId,
    data: {
      field: formatFieldPath(field),
      requestId,
      hasInstruction: Boolean(input.instruction),
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    },
  });
  const { runId } = await triggerJob(
    ctx,
    "regenerate-field",
    {
      variantId: variant.id,
      field: formatFieldPath(field),
      lockVersion: input.lockVersion,
      requestId,
      ...(input.instruction ? { instruction: input.instruction } : {}),
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(ctx.actor.type === "USER" ? { requestedBy: ctx.actor.userId } : {}),
      ...(input.confirmed ? { confirmed: true } : {}),
    },
    { idempotencyKey: `regen:${requestId}` },
  );
  return { jobRunId: runId, requestId };
}

// ---- the model's value as a stored value ------------------------------------------------------

/** The stored value of a field from the model's answer (the shape of `valueSchema`). */
function storedValue(field: ParsedFieldPath, value: unknown, content: VariantContent): unknown {
  switch (field.kind) {
    case "cta": {
      const v = value as { type: string; text: string; keyword?: string };
      const old = content.cta;
      const cta: CtaSpec = {
        type: v.type,
        text: v.text,
        ...(v.keyword ? { keyword: v.keyword } : {}),
        ...(old.offerId ? { offerId: old.offerId } : {}),
        ...(old.linkMode ? { linkMode: old.linkMode } : {}),
      };
      return cta;
    }
    case "slide": {
      const v = value as {
        role: Slide["role"];
        templateId: Slide["templateId"];
        slots: { slot: string; text: string }[];
        knowledgeIds: string[];
        factual: boolean;
        altText: string;
      };
      const old = content.slides.find((s) => s.id === field.slideId) as Slide;
      const imageSlots = Object.keys(registry.get(v.templateId)?.imageSlots ?? {});
      const slide: Slide = {
        id: old.id,
        index: old.index,
        role: v.role,
        templateId: v.templateId,
        slots: Object.fromEntries(v.slots.map((s) => [s.slot, s.text])),
        images: Object.fromEntries(
          Object.entries(old.images).filter(([name]) => imageSlots.includes(name)),
        ),
        knowledgeIds: v.knowledgeIds,
        factual: v.factual,
        ...(v.altText.trim() ? { altText: v.altText } : {}),
      };
      return slide;
    }
    case "hashtags":
      return (value as string[]).map((t) => t.trim());
    case "hook":
    case "caption":
      return (value as string).trim();
    default:
      return value;
  }
}

/** Findings about the new value, as the editing path would find them. */
async function findingsFor(
  c: Awaited<ReturnType<typeof loadPipelineContext>>,
  variant: Variant,
  content: VariantContent,
  field: ParsedFieldPath,
  value: unknown,
): Promise<ValidationIssue[]> {
  const market = c.markets.get(variant.marketId);
  const context: ValidationContext = {
    locale: market?.language === "es" ? "es-ES" : market?.language === "ru" ? "ru" : "en",
    forbiddenPatterns: market?.forbiddenPatterns ?? [],
    ideaKnowledgeIds: new Set(c.cards.map((card) => card.id)),
    numericReference: numericReference(c),
  };
  const draft = toDraft(writeField(content, field, value), variant.hookType);
  return [
    ...validateSlots(draft, context),
    ...validateTextRules(draft, context),
    ...validateForbiddenPatterns(draft, context),
    ...validateCitations(draft, context),
    ...validateNumericFidelity(draft, context),
  ].filter((issue) => isWithin(issue.fieldPath, field));
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * J6 `regenerate-field`: asks the model for a new value of one field and applies it. A lock
 * version that moved on (the reviewer kept editing) drops the result; a value that does not pass
 * the checks after one repair is a FAILED outcome, not an exception. Transient errors are
 * rethrown so the run is retried (the lock check keeps a retry from applying twice).
 */
export async function runFieldRegeneration(
  ctx: ServiceContext,
  raw: RegenerateFieldPayload,
): Promise<RegenerationOutcome> {
  const payload = RegenerateFieldPayload.parse(raw);
  const field = parseFieldPath(payload.field);
  const path = formatFieldPath(field);
  const kind = kindOf(field);

  const [variant] = await ctx.db
    .select()
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.id, payload.variantId));
  if (!variant)
    throw new NotFoundError("Variant not found.", { details: { id: payload.variantId } });

  const discard = async (outcome: RegenerationOutcome, why: string) => {
    await audit(ctx, {
      action: "variant.field_regeneration_discarded",
      entityType: "content_variant",
      entityId: variant.id,
      marketId: variant.marketId,
      data: { field: path, requestId: payload.requestId, why },
    });
    return outcome;
  };
  if (variant.lockVersion !== payload.lockVersion)
    return discard({ status: "CONFLICT" }, "stale lock");
  const transitionRow = (() => {
    try {
      return assertTransition(variant.status, "EDIT");
    } catch {
      return null;
    }
  })();
  if (!transitionRow) {
    return discard(
      { status: "SKIPPED", reason: `The variant is ${variant.status}.` },
      variant.status,
    );
  }
  const invalidates = transitionRow.to !== variant.status;
  if (invalidates && !payload.confirmed) {
    return discard({ status: "SKIPPED", reason: "The approval was not confirmed." }, "unconfirmed");
  }
  const content = variant.format === "REEL" ? null : contentOf(variant);
  const brief = variant.marketBriefJson;
  if (!content || !brief) {
    return discard({ status: "SKIPPED", reason: "The variant has no draft or plan." }, "no draft");
  }

  const c = await loadPipelineContext(ctx, variant.masterIdeaId, [variant.id]);
  const market = c.markets.get(variant.marketId);
  if (!market) throw new NotFoundError("Market not found.", { details: { id: variant.marketId } });

  const others = c.others;
  const otherMarkets = others.length
    ? await ctx.db
        .select({ id: schema.markets.id, code: schema.markets.code })
        .from(schema.markets)
        .where(
          inArray(
            schema.markets.id,
            others.map((o) => o.marketId),
          ),
        )
    : [];
  const siblings: SiblingDraft[] = others
    .filter((o) => o.hook)
    .map((o) => ({
      marketCode: otherMarkets.find((m) => m.id === o.marketId)?.code ?? "",
      hook: o.hook ?? "",
      gist: gistOf(o.marketBriefJson, o.hook ?? ""),
    }));
  const base = writerInput(c, market, brief, siblings);

  const plan = planOf(variant.visualBriefJson, field);
  const reason = payload.reasonCode
    ? await ctx.db
        .select({ label: schema.taxonomyTerms.label })
        .from(schema.taxonomyTerms)
        .where(eq(schema.taxonomyTerms.code, payload.reasonCode))
        .then((rows) => ({
          code: payload.reasonCode as string,
          label: rows[0]?.label ?? (payload.reasonCode as string),
        }))
    : undefined;
  const input: fieldRegenerator.FieldRegeneratorInput = {
    brandVoice: base.brandVoice,
    idea: base.idea,
    cards: base.cards,
    market: base.market,
    brief: base.brief,
    conversions: base.conversions,
    ...(base.offer ? { offer: base.offer } : {}),
    templates: base.templates,
    siblingSummary: base.siblingSummary,
    taxonomy: base.taxonomy,
    draft: {
      hook: content.hook,
      hookType: variant.hookType ?? brief.hookType,
      caption: content.caption,
      cta: {
        type: content.cta.type,
        text: content.cta.text,
        ...(content.cta.keyword ? { keyword: content.cta.keyword } : {}),
      },
      hashtags: content.hashtags,
      slides: content.slides.map((s) => ({
        id: s.id,
        index: s.index,
        role: s.role,
        templateId: s.templateId,
        slots: Object.entries(s.slots).map(([slot, text]) => ({ slot, text })),
        knowledgeIds: s.knowledgeIds,
        factual: s.factual,
        ...(s.altText ? { altText: s.altText } : {}),
      })),
    },
    field: {
      path,
      kind,
      ...("slideId" in field ? { slideId: field.slideId } : {}),
      ...("slot" in field ? { slot: field.slot } : {}),
    },
    ...(plan
      ? {
          image: {
            prompt: plan.prompt ?? "",
            ...(plan.negativePrompt ? { negativePrompt: plan.negativePrompt } : {}),
            composition: plan.composition,
            aspect: plan.aspect,
            style: variant.visualBriefJson?.visualStyle ?? "",
          },
        }
      : {}),
    ...(payload.instruction ? { instruction: payload.instruction } : {}),
    ...(reason ? { reason } : {}),
  };

  const result = await runStage<Output>(ctx, {
    stage: "FIELD_REGENERATION",
    input,
    inputRefs: { masterIdeaId: variant.masterIdeaId, variantId: variant.id },
    validate: async (output) => {
      if (kind === "image") {
        const image = output.value as fieldRegenerator.ImageValue;
        const issues: ValidationIssue[] = [];
        if (!image.prompt.trim()) {
          issues.push({
            code: "IMAGE_PROMPT_EMPTY",
            severity: "BLOCKER",
            fieldPath: path,
            message: "The picture prompt is empty.",
            fixHint: "Describe the picture.",
          });
        }
        return issues;
      }
      return findingsFor(c, variant, content, field, storedValue(field, output.value, content));
    },
  });
  await ctx.db
    .update(schema.generationRuns)
    .set({ masterIdeaId: variant.masterIdeaId, contentVariantId: variant.id })
    .where(inArray(schema.generationRuns.id, result.runIds));
  if (!result.data) {
    return discard(
      {
        status: "FAILED",
        message: "The model gave no usable value. Try again or edit the field by hand.",
        issues: result.issues,
      },
      result.status,
    );
  }

  const reviewer = payload.requestedBy ?? (ctx.actor.type === "USER" ? ctx.actor.userId : null);
  const common = {
    variant,
    content,
    field,
    action: "REGENERATE" as const,
    lockVersion: payload.lockVersion,
    invalidates,
    reasonCode: payload.reasonCode,
    reason: payload.instruction,
    reviewerId: reviewer,
    generationRunId: result.runId,
  };

  try {
    if (kind === "image") {
      const image = result.data.value as fieldRegenerator.ImageValue;
      const brief0 = variant.visualBriefJson as VisualBrief;
      const entry = plan as NonNullable<typeof plan>;
      const edited = {
        ...entry,
        source: "GENERATE" as const,
        prompt: image.prompt.trim(),
        negativePrompt: image.negativePrompt.trim(),
        composition: image.composition.trim(),
      };
      delete (edited as { libraryAssetId?: string }).libraryAssetId;
      const nextBrief: VisualBrief = {
        ...brief0,
        slides: brief0.slides.map((p) => (p === entry ? edited : p)),
      };
      const applied = await applyFieldChange(ctx, {
        ...common,
        value: edited,
        original: entry,
        next: { ...content, visualBrief: nextBrief },
        queueRender: false,
      });
      // The new picture; J7 queues the render when it is done.
      await triggerJob(
        ctx,
        "generate-visual-assets",
        { variantId: variant.id, slots: [{ slideId: edited.slideId, slot: edited.slot }] },
        { idempotencyKey: `regen-image:${payload.requestId}` },
      );
      return {
        status: "APPLIED",
        reviewEventId: applied.reviewEventId ?? "",
        runId: result.runId,
        rationale: result.data.rationale,
      };
    }

    const value = storedValue(field, result.data.value, content);
    const original = readField(content, field);
    if (sameJson(original, value)) return { status: "UNCHANGED", runId: result.runId };
    const applied = await applyFieldChange(ctx, { ...common, value, original });
    return {
      status: "APPLIED",
      reviewEventId: applied.reviewEventId ?? "",
      runId: result.runId,
      rationale: result.data.rationale,
    };
  } catch (error) {
    if (error instanceof ConflictError) return discard({ status: "CONFLICT" }, "stale lock");
    if (error instanceof AppError && error.code === "VALIDATION") {
      return discard(
        { status: "FAILED", message: error.message, issues: result.issues },
        "validation",
      );
    }
    throw error;
  }
}
