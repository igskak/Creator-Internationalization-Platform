import { schema } from "@rc/db";
import { asc } from "@rc/db/orm";
import { TAXONOMY_KINDS } from "@rc/db/schema";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../core";

export type TaxonomyTerm = typeof schema.taxonomyTerms.$inferSelect;

export function listTaxonomyTerms(ctx: ServiceContext): Promise<TaxonomyTerm[]> {
  return ctx.db
    .select()
    .from(schema.taxonomyTerms)
    .orderBy(
      asc(schema.taxonomyTerms.kind),
      asc(schema.taxonomyTerms.sortOrder),
      asc(schema.taxonomyTerms.code),
    );
}

const UpperSnake = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/, "Use UPPER_SNAKE_CASE, e.g. QUICK_TIP");

export const UpsertTaxonomyTermInput = z.object({
  kind: z.enum(TAXONOMY_KINDS),
  code: UpperSnake,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  parentCode: UpperSnake.nullable().optional(),
  isActive: z.boolean(),
});
export type UpsertTaxonomyTermInput = z.input<typeof UpsertTaxonomyTermInput>;

/**
 * 05 §5.2 upsertTaxonomyTerm (owner). Terms are never deleted, only deactivated, because content
 * rows keep their codes. Audit `settings.changed` (12 §12.6).
 */
export async function upsertTaxonomyTerm(
  ctx: ServiceContext,
  raw: UpsertTaxonomyTermInput,
): Promise<TaxonomyTerm> {
  const input = UpsertTaxonomyTermInput.parse(raw);
  const values = {
    kind: input.kind,
    code: input.code,
    label: input.label,
    description: input.description ?? null,
    parentCode: input.parentCode ?? null,
    isActive: input.isActive,
  };
  return withTransaction(ctx, async (tx) => {
    const [term] = await tx.db
      .insert(schema.taxonomyTerms)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.taxonomyTerms.kind, schema.taxonomyTerms.code],
        set: {
          label: values.label,
          description: values.description,
          parentCode: values.parentCode,
          isActive: values.isActive,
        },
      })
      .returning();
    if (!term) throw new Error("upsertTaxonomyTerm: no row returned");
    await audit(tx, {
      action: "settings.changed",
      entityType: "taxonomy_term",
      entityId: term.id,
      // `termCode`, not `code`: audit data redacts any `code` key (possible OAuth code, M0-05).
      data: { setting: "taxonomy", kind: term.kind, termCode: term.code, isActive: term.isActive },
    });
    return term;
  });
}
