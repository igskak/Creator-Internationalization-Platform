import { schema } from "@rc/db";
import { and, eq, inArray, notInArray } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../../core";
import {
  assertProductAndIntent,
  assertTaxonomy,
  COMMERCIAL_INTENTS,
  KnowledgeLinks,
  resolveApprovedLinks,
} from "./shared";

type Idea = typeof schema.masterIdeas.$inferSelect;

const parse = <S extends z.ZodType>(input: S, raw: unknown): z.output<S> => {
  const parsed = input.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
};

const text = (max: number) => z.string().trim().min(1).max(max);

export const CreateManualIdeaInput = z.object({
  topic: text(200),
  category: text(100),
  angle: text(100),
  /** English (D-16). */
  coreMessage: text(600),
  knowledge: KnowledgeLinks,
  recommendedFormat: z.literal("CAROUSEL").default("CAROUSEL"),
  commercialIntent: z.enum(COMMERCIAL_INTENTS).default("NONE"),
  productId: z.uuid().optional(),
});

const actorUserId = (ctx: ServiceContext) => (ctx.actor.type === "USER" ? ctx.actor.userId : null);

/**
 * A person's own idea (plan 05 §5.6): PROPOSED, origin MANUAL, linked to the approved version of
 * each chosen card. Every card must be CHEF_APPROVED; one at least is primary.
 */
export async function createManualIdea(
  ctx: ServiceContext,
  raw: z.input<typeof CreateManualIdeaInput>,
): Promise<Idea> {
  const input = parse(CreateManualIdeaInput, raw);
  await assertTaxonomy(ctx, { category: input.category, angle: input.angle });
  await assertProductAndIntent(ctx, input.productId, input.commercialIntent);
  const links = await resolveApprovedLinks(ctx, input.knowledge);

  return withTransaction(ctx, async (tx) => {
    const [idea] = await tx.db
      .insert(schema.masterIdeas)
      .values({
        brandId: await brandIdOf(tx),
        topic: input.topic,
        category: input.category,
        angle: input.angle,
        coreMessage: input.coreMessage,
        recommendedFormat: input.recommendedFormat,
        commercialIntent: input.commercialIntent,
        productId: input.productId ?? null,
        origin: "MANUAL",
        createdBy: actorUserId(ctx),
      })
      .returning();
    if (!idea) throw new Error("Insert returned no row.");
    await tx.db
      .insert(schema.masterIdeaKnowledge)
      .values(links.map((l) => ({ masterIdeaId: idea.id, ...l })));
    await audit(tx, {
      action: "idea.created",
      entityType: "master_idea",
      entityId: idea.id,
      data: { origin: "MANUAL", cards: links.length },
    });
    return idea;
  });
}

async function brandIdOf(ctx: ServiceContext): Promise<string> {
  const [brand] = await ctx.db.select({ id: schema.brands.id }).from(schema.brands).limit(1);
  if (!brand) throw new InvalidStateError("No brand is set up.");
  return brand.id;
}

/** Variants in these statuses are being worked on or live, so the idea behind them is frozen. */
const EDITABLE_VARIANT_STATUSES = ["DRAFT", "REJECTED"] as const;

export const UpdateIdeaInput = z.object({
  id: z.uuid(),
  patch: z
    .object({
      topic: text(200),
      category: text(100),
      angle: text(100),
      coreMessage: text(600),
      commercialIntent: z.enum(COMMERCIAL_INTENTS),
      productId: z.uuid().nullable(),
      knowledge: KnowledgeLinks,
    })
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, { message: "Nothing to change." }),
});

/**
 * Edits a PROPOSED or ACCEPTED idea unless a variant of it is past DRAFT (plan 05 §5.6). The new
 * values are checked as a whole (taxonomy, product with intent, approved cards); replacing the
 * cards re-links the current approved versions. Audited with the names of the changed fields.
 */
export async function updateIdea(
  ctx: ServiceContext,
  raw: z.input<typeof UpdateIdeaInput>,
): Promise<Idea> {
  const { id, patch } = parse(UpdateIdeaInput, raw);
  const [current] = await ctx.db
    .select()
    .from(schema.masterIdeas)
    .where(eq(schema.masterIdeas.id, id));
  if (!current) throw new NotFoundError("Idea not found.", { details: { id } });
  if (current.status !== "PROPOSED" && current.status !== "ACCEPTED") {
    throw new InvalidStateError(`A ${current.status} idea cannot be edited. Restore it first.`, {
      details: { id, status: current.status },
    });
  }
  const busy = await ctx.db
    .select({ id: schema.contentVariants.id, status: schema.contentVariants.status })
    .from(schema.contentVariants)
    .where(
      and(
        eq(schema.contentVariants.masterIdeaId, id),
        notInArray(schema.contentVariants.status, [...EDITABLE_VARIANT_STATUSES]),
      ),
    );
  if (busy.length > 0) {
    throw new InvalidStateError("Variants of this idea are already past the draft stage.", {
      details: { variants: busy },
    });
  }

  const productId = patch.productId === undefined ? current.productId : patch.productId;
  const intent = patch.commercialIntent ?? current.commercialIntent;
  await assertTaxonomy(ctx, {
    ...(patch.category !== undefined ? { category: patch.category } : {}),
    ...(patch.angle !== undefined ? { angle: patch.angle } : {}),
  });
  if (patch.productId !== undefined || patch.commercialIntent !== undefined) {
    await assertProductAndIntent(ctx, productId, intent);
  }
  const links = patch.knowledge ? await resolveApprovedLinks(ctx, patch.knowledge) : undefined;

  const { knowledge: _knowledge, ...columns } = patch;
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(schema.masterIdeas)
      // A patch of the cards alone has no column to set; touching updated_at keeps the update valid.
      .set(Object.keys(columns).length > 0 ? columns : { updatedAt: ctx.clock.now() })
      .where(
        and(
          eq(schema.masterIdeas.id, id),
          inArray(schema.masterIdeas.status, ["PROPOSED", "ACCEPTED"]),
        ),
      )
      .returning();
    if (!row)
      throw new InvalidStateError("The idea changed while you edited it.", { details: { id } });
    if (links) {
      await tx.db
        .delete(schema.masterIdeaKnowledge)
        .where(eq(schema.masterIdeaKnowledge.masterIdeaId, id));
      await tx.db
        .insert(schema.masterIdeaKnowledge)
        .values(links.map((l) => ({ masterIdeaId: id, ...l })));
    }
    await audit(tx, {
      action: "idea.updated",
      entityType: "master_idea",
      entityId: id,
      data: { fields: Object.keys(patch) },
    });
    return row;
  });
}
