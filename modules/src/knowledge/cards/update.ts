import { schema } from "@rc/db";
import {
  CommonMistakeList,
  IngredientList,
  ProcedureList,
  TemperatureList,
  TimingList,
} from "@rc/db/json";
import { and, eq } from "@rc/db/orm";
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../../core";
import { requestEmbedding } from "../embedding";
import { LOW_CONFIDENCE_THRESHOLD } from "../extraction/assess";
import { safetyReasons } from "../extraction/safety";
import { verifyNumbers } from "../extraction/verify-quote";
import { loadEvidencePages, toCardView } from "./detail";

// Editing a card (plan 05 §5.4 `updateKnowledgeCard`, 10 §10.4.1): optimistic lock on `version`;
// editing an approved card sends it back to review as the next version.

type Card = typeof schema.knowledgeItems.$inferSelect;

export const KnowledgeCardPatch = z
  .object({
    title: z.string().trim().min(1).max(300),
    category: z.string().trim().min(1).max(64),
    subcategory: z.string().trim().max(64).nullable(),
    claim: z.string().trim().min(1).max(2000),
    explanation: z.string().trim().max(5000),
    procedure: ProcedureList.max(50),
    ingredients: IngredientList.max(100),
    temperatures: TemperatureList.max(30),
    timings: TimingList.max(30),
    commonMistakes: CommonMistakeList.max(30),
    safetySensitive: z.boolean(),
    safetyNotes: z.string().trim().max(1000).nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
  })
  .partial()
  .strict();
export type KnowledgeCardPatch = z.infer<typeof KnowledgeCardPatch>;

export const UpdateCardInput = z.object({
  id: z.uuid(),
  /** The version the editor was looking at; a different one means someone else edited the card. */
  version: z.number().int().min(1),
  patch: KnowledgeCardPatch,
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Steps are numbered by their order, whatever the editor sent. */
const renumber = <T extends { n: number }>(steps: T[]) =>
  steps.map((step, i) => ({ ...step, n: i + 1 }));

export async function updateKnowledgeCard(
  ctx: ServiceContext,
  raw: z.input<typeof UpdateCardInput>,
): Promise<ReturnType<typeof toCardView>> {
  const parsed = UpdateCardInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { id, version, patch } = parsed.data;
  if (Object.keys(patch).length === 0) {
    throw new ValidationError("Nothing to save.", {
      fieldErrors: { _form: ["Change at least one field."] },
    });
  }

  const [card] = await ctx.db
    .select()
    .from(schema.knowledgeItems)
    .where(eq(schema.knowledgeItems.id, id));
  if (!card) throw new NotFoundError("Knowledge card not found.", { details: { id } });
  if (card.reviewStatus === "ARCHIVED") {
    throw new InvalidStateError("An archived card cannot be edited. Restore it first.");
  }
  if (card.version !== version) {
    throw new ConflictError("This card was changed by someone else. Reload it and try again.", {
      details: { id, yours: version, current: card.version },
    });
  }

  if (patch.category && patch.category !== card.category) {
    const [term] = await ctx.db
      .select({ code: schema.taxonomyTerms.code })
      .from(schema.taxonomyTerms)
      .where(
        and(
          eq(schema.taxonomyTerms.kind, "category"),
          eq(schema.taxonomyTerms.code, patch.category),
          eq(schema.taxonomyTerms.isActive, true),
        ),
      );
    if (!term) {
      throw new ValidationError("Unknown category.", {
        fieldErrors: { category: ["Choose a category from the list."] },
      });
    }
  }

  // The new content, field by field; only fields that really change count as an edit.
  const next = {
    title: patch.title ?? card.title,
    category: patch.category ?? card.category,
    subcategory: patch.subcategory === undefined ? card.subcategory : patch.subcategory || null,
    claim: patch.claim ?? card.claim,
    explanation: patch.explanation ?? card.explanation,
    procedureJson: patch.procedure ? renumber(patch.procedure) : card.procedureJson,
    ingredientsJson: patch.ingredients ?? card.ingredientsJson,
    temperaturesJson: patch.temperatures ?? card.temperaturesJson,
    timingsJson: patch.timings ?? card.timingsJson,
    commonMistakesJson: patch.commonMistakes ?? card.commonMistakesJson,
    safetyNotes: patch.safetyNotes === undefined ? card.safetyNotes : patch.safetyNotes || null,
    tags: patch.tags ?? card.tags,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (key) => !same(next[key], card[key]),
  );
  const safetyPatched =
    patch.safetySensitive !== undefined && patch.safetySensitive !== card.safetySensitive;
  if (changed.length === 0 && !safetyPatched) return toCardView(card);

  // Flags that depend on the content follow the edit: numbers against the cited pages, and the
  // safety flag (the editor's choice wins; otherwise the keyword rules can only raise it).
  const flags = new Set(card.reviewFlags);
  const ref = card.sourceReference;
  if (ref?.pageStart) {
    const [source] = card.sourceAssetId
      ? await ctx.db
          .select()
          .from(schema.sourceAssets)
          .where(eq(schema.sourceAssets.id, card.sourceAssetId))
      : [];
    const pages = (await loadEvidencePages(ctx, card, source ?? null)).map((p) => ({
      pageNumber: p.pageNumber,
      text: p.text,
    }));
    const missing = verifyNumbers(
      { temperatures: next.temperaturesJson, timings: next.timingsJson },
      pages,
      { pageStart: ref.pageStart, pageEnd: ref.pageEnd ?? ref.pageStart },
    ).missing;
    const lowConfidence =
      (card.confidence !== null && Number(card.confidence) < LOW_CONFIDENCE_THRESHOLD) ||
      missing.length > 0;
    if (lowConfidence) flags.add("LOW_CONFIDENCE");
    else flags.delete("LOW_CONFIDENCE");
  }
  let safetySensitive = patch.safetySensitive ?? card.safetySensitive;
  if (patch.safetySensitive === undefined && !safetySensitive) {
    const text = [
      next.title,
      next.claim,
      next.explanation,
      ...next.procedureJson.map((s) => s.text),
    ].join("\n");
    if (safetyReasons(text).length > 0 || next.temperaturesJson.some((t) => t.target === "CORE")) {
      safetySensitive = true;
    }
  }
  if (safetySensitive) flags.add("SAFETY_SENSITIVE");
  else flags.delete("SAFETY_SENSITIVE");

  const wasApproved = card.reviewStatus === "CHEF_APPROVED";
  const nextVersion = wasApproved ? card.version + 1 : card.version;
  const updated = await withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(schema.knowledgeItems)
      .set({
        ...next,
        safetySensitive,
        reviewFlags: [...flags],
        version: nextVersion,
        ...(wasApproved ? { reviewStatus: "NEEDS_REVIEW" as const } : {}),
      })
      // The version check again, inside the update: two editors saving together cannot both win.
      .where(and(eq(schema.knowledgeItems.id, id), eq(schema.knowledgeItems.version, version)))
      .returning();
    if (!row)
      throw new ConflictError("This card was changed by someone else. Reload it and try again.");
    await audit(tx, {
      action: wasApproved ? "knowledge.edited_after_approval" : "knowledge.edited",
      entityType: "knowledge_item",
      entityId: id,
      data: {
        fields: [
          ...changed.map((key) => key.replace(/Json$/, "")),
          ...(safetyPatched ? ["safetySensitive"] : []),
        ],
        version: { from: version, to: nextVersion },
        ...(wasApproved ? { status: { from: "CHEF_APPROVED", to: "NEEDS_REVIEW" } } : {}),
      },
    });
    return row;
  });

  // The text changed, so the vector and the duplicate suggestion are refreshed in the background.
  await requestEmbedding(ctx, [id]).catch((error: unknown) =>
    ctx.logger.warn({ err: error, id }, "could not request the embedding of an edited card"),
  );
  return toCardView(updated);
}
