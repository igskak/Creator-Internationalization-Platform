import { schema } from "@rc/db";
import { and, asc, eq } from "@rc/db/orm";
import type { ServiceContext } from "../../core";

export type ExtractionTaxonomy = {
  categories: { code: string; label: string; description?: string }[];
  subcategories: { code: string; label: string; description?: string; parentCode: string }[];
};

/** Active category and subcategory terms, in display order, for the extractor's enums. */
export async function loadExtractionTaxonomy(ctx: ServiceContext): Promise<ExtractionTaxonomy> {
  const rows = await ctx.db
    .select()
    .from(schema.taxonomyTerms)
    .where(and(eq(schema.taxonomyTerms.isActive, true)))
    .orderBy(asc(schema.taxonomyTerms.sortOrder), asc(schema.taxonomyTerms.code));
  const term = (row: (typeof rows)[number]) => ({
    code: row.code,
    label: row.label,
    ...(row.description ? { description: row.description } : {}),
  });
  return {
    categories: rows.filter((r) => r.kind === "category").map(term),
    subcategories: rows
      .filter((r) => r.kind === "subcategory" && r.parentCode)
      .map((r) => ({ ...term(r), parentCode: r.parentCode ?? "" })),
  };
}
