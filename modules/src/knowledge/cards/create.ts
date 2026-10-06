import { schema } from "@rc/db";
import {
  CommonMistakeList,
  IngredientList,
  ProcedureList,
  TemperatureList,
  TimingList,
} from "@rc/db/json";
import { and, eq } from "@rc/db/orm";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../../core";
import { requestEmbedding } from "../embedding";
import { safetyReasons } from "../extraction/safety";
import { toCardView } from "./detail";

// A card written by hand (plan 05 §5.4 `createManualKnowledgeCard`, M1-20): origin MANUAL, status
// NEEDS_REVIEW, so it goes through the same approval as an extracted card.

export const CreateManualCardInput = z.object({
  title: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(64),
  subcategory: z.string().trim().max(64).nullable().optional(),
  claim: z.string().trim().min(1).max(2000),
  explanation: z.string().trim().max(5000).default(""),
  procedure: ProcedureList.max(50).default([]),
  ingredients: IngredientList.max(100).default([]),
  temperatures: TemperatureList.max(30).default([]),
  timings: TimingList.max(30).default([]),
  commonMistakes: CommonMistakeList.max(30).default([]),
  safetySensitive: z.boolean().optional(),
  safetyNotes: z.string().trim().max(1000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** The language the card is written in; a card with a source takes the source's language. */
  language: z.string().trim().min(2).max(16).optional(),
  /** Where the knowledge comes from, when it comes from a source we hold. */
  source: z
    .object({
      sourceAssetId: z.uuid(),
      pageStart: z.number().int().positive().optional(),
      pageEnd: z.number().int().positive().optional(),
    })
    .optional(),
});

export async function createManualKnowledgeCard(
  ctx: ServiceContext,
  raw: z.input<typeof CreateManualCardInput>,
): Promise<ReturnType<typeof toCardView>> {
  const parsed = CreateManualCardInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const input = parsed.data;

  const [term] = await ctx.db
    .select({ code: schema.taxonomyTerms.code })
    .from(schema.taxonomyTerms)
    .where(
      and(
        eq(schema.taxonomyTerms.kind, "category"),
        eq(schema.taxonomyTerms.code, input.category),
        eq(schema.taxonomyTerms.isActive, true),
      ),
    );
  if (!term) {
    throw new ValidationError("Unknown category.", {
      fieldErrors: { category: ["Choose a category from the list."] },
    });
  }

  const [source] = input.source
    ? await ctx.db
        .select()
        .from(schema.sourceAssets)
        .where(eq(schema.sourceAssets.id, input.source.sourceAssetId))
    : [];
  if (input.source && !source) {
    throw new NotFoundError("Source not found.", {
      details: { sourceAssetId: input.source.sourceAssetId },
    });
  }
  const language = source?.originalLanguage ?? input.language;
  if (!language) {
    throw new ValidationError("Choose the language of the card.", {
      fieldErrors: { language: ["A language is required."] },
    });
  }
  const pageStart = input.source?.pageStart;
  const pageEnd = input.source?.pageEnd ?? pageStart;
  if (pageStart && pageEnd && pageEnd < pageStart) {
    throw new ValidationError("The last page is before the first.", {
      fieldErrors: { "source.pageEnd": ["Enter a page after the first one."] },
    });
  }

  const [brand] = source
    ? [{ id: source.brandId }]
    : await ctx.db.select({ id: schema.brands.id }).from(schema.brands).limit(1);
  if (!brand) throw new NotFoundError("Brand is not set up.");

  const text = [
    input.title,
    input.claim,
    input.explanation,
    ...input.procedure.map((s) => s.text),
  ].join("\n");
  const safetySensitive =
    input.safetySensitive ??
    (safetyReasons(text).length > 0 || input.temperatures.some((t) => t.target === "CORE"));
  const actorId = ctx.actor.type === "USER" ? ctx.actor.userId : null;

  const card = await withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(schema.knowledgeItems)
      .values({
        brandId: brand.id,
        title: input.title,
        category: input.category,
        subcategory: input.subcategory || null,
        claim: input.claim,
        explanation: input.explanation,
        procedureJson: input.procedure.map((step, i) => ({ ...step, n: i + 1 })),
        ingredientsJson: input.ingredients,
        temperaturesJson: input.temperatures,
        timingsJson: input.timings,
        commonMistakesJson: input.commonMistakes,
        sourceAssetId: source?.id ?? null,
        // Written by hand, so there is no quote to check; the pages only tell the reader where to look.
        sourceReference: pageStart
          ? {
              pageStart,
              ...(pageEnd ? { pageEnd } : {}),
              quote: "",
              quoteVerified: true,
              note: "Entered by hand",
            }
          : null,
        language,
        origin: "MANUAL",
        reviewStatus: "NEEDS_REVIEW",
        reviewFlags: safetySensitive ? ["SAFETY_SENSITIVE"] : [],
        safetySensitive,
        safetyNotes: input.safetyNotes || null,
        tags: input.tags,
        createdBy: actorId,
      })
      .returning();
    if (!row) throw new Error("The card was not saved.");
    await audit(tx, {
      action: "knowledge.created_manual",
      entityType: "knowledge_item",
      entityId: row.id,
      data: { category: row.category, language, ...(source ? { sourceAssetId: source.id } : {}) },
    });
    return row;
  });

  await requestEmbedding(ctx, [card.id]).catch((error: unknown) =>
    ctx.logger.warn({ err: error, id: card.id }, "could not request the embedding of a new card"),
  );
  return toCardView(card);
}
