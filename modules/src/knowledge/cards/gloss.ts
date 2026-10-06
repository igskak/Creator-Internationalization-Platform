import { schema } from "@rc/db";
import type { KnowledgeGloss, ValidationIssue } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { embeddingHash } from "@rc/lib/providers/embeddings";
import type { knowledgeGloss } from "@rc/prompts";
import { z } from "zod";
import { runStage, STAGE_CONFIG } from "../../ai";
import { audit, type ServiceContext } from "../../core";
import { statedNumbers } from "../extraction/verify-quote";
import { assertCanProcessWithAI } from "../rights";

// English gloss of a card (plan 05 `requestCardGloss`, M1-24): a reading aid for an editor who
// does not read the card's language. It is cached on the card, labelled "not approved text" in the
// UI, and never part of the approved snapshot, the card embedding, retrieval or generation.

type Output = knowledgeGloss.GlossOutput;

export const RequestCardGlossInput = z.object({
  id: z.uuid(),
  /** Make a new gloss even if the cached one is current. */
  refresh: z.boolean().default(false),
});

/** What the gloss was made from: when the card text changes, the hash changes. */
export const glossTextHash = (card: { title: string; claim: string; explanation: string }) =>
  embeddingHash([card.title, card.claim, card.explanation].join("\n"));

/** A faithful translation keeps every number of the original. */
export function validateGloss(
  output: Output,
  card: { title: string; claim: string; explanation: string },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const blocker = (code: string, fieldPath: string, message: string, fixHint?: string) =>
    issues.push({ code, severity: "BLOCKER", fieldPath, message, ...(fixHint ? { fixHint } : {}) });
  if (!output.title.trim()) blocker("EMPTY_FIELD", "title", "The title is empty.");
  if (!output.claim.trim()) blocker("EMPTY_FIELD", "claim", "The claim is empty.");
  if (card.explanation.trim() && !output.explanation.trim()) {
    blocker("EMPTY_FIELD", "explanation", "The explanation is empty but the original has one.");
  }
  const original = statedNumbers([card.title, card.claim, card.explanation].join("\n"));
  const translated = statedNumbers([output.title, output.claim, output.explanation].join("\n"));
  const missing = [...original].filter((n) => !translated.has(n));
  if (missing.length > 0) {
    blocker(
      "NUMBERS_CHANGED",
      "claim",
      `The numbers ${missing.join(", ")} of the original are missing from the translation.`,
      "Keep every number and unit exactly as written.",
    );
  }
  return issues;
}

export async function requestCardGloss(
  ctx: ServiceContext,
  raw: z.input<typeof RequestCardGlossInput>,
): Promise<{ gloss: KnowledgeGloss; cached: boolean }> {
  const parsed = RequestCardGlossInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { id, refresh } = parsed.data;

  const [card] = await ctx.db
    .select()
    .from(schema.knowledgeItems)
    .where(eq(schema.knowledgeItems.id, id));
  if (!card) throw new NotFoundError("Knowledge card not found.", { details: { id } });
  if (card.language === "en") {
    throw new ValidationError("This card is already in English.", {
      fieldErrors: { _form: ["The card is written in English."] },
    });
  }
  const hash = glossTextHash(card);
  if (!refresh && card.glossEn && card.glossEn.textHash === hash) {
    return { gloss: card.glossEn, cached: true };
  }

  // The card text goes to a vendor: a card of a source needs the source's AI-processing right.
  if (card.sourceAssetId) {
    const [source] = await ctx.db
      .select()
      .from(schema.sourceAssets)
      .where(eq(schema.sourceAssets.id, card.sourceAssetId));
    if (source) assertCanProcessWithAI(source);
  }

  const stage = await runStage<Output>(ctx, {
    stage: "KNOWLEDGE_GLOSS",
    input: {
      language: card.language,
      card: { title: card.title, claim: card.claim, explanation: card.explanation },
    },
    validate: (output) => validateGloss(output, card),
    inputRefs: { knowledgeItemIds: [card.id] },
    ...(card.sourceAssetId ? { sourceAssetId: card.sourceAssetId } : {}),
  });
  if (!stage.data) {
    throw new ValidationError("The translation could not be made. Try again.", {
      fieldErrors: { _form: ["The model's answer could not be used."] },
    });
  }
  const gloss: KnowledgeGloss = {
    title: stage.data.title.trim(),
    claim: stage.data.claim.trim(),
    explanation: stage.data.explanation.trim(),
    model: STAGE_CONFIG.KNOWLEDGE_GLOSS.model,
    createdAt: ctx.clock.now().toISOString(),
    textHash: hash,
  };
  await ctx.db
    .update(schema.knowledgeItems)
    .set({ glossEn: gloss })
    .where(eq(schema.knowledgeItems.id, card.id));
  await audit(ctx, {
    action: "knowledge.gloss_made",
    entityType: "knowledge_item",
    entityId: card.id,
    data: { runId: stage.runId, refresh },
  });
  return { gloss, cached: false };
}
