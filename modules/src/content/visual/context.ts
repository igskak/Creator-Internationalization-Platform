import { schema } from "@rc/db";
import { and, asc, eq } from "@rc/db/orm";
import type { ServiceContext } from "../../core";
import { listLibraryCandidates } from "../../visuals";
import type { LibraryCandidate, TaxonomyTerm } from "./inputs";

/** Active `visual_style` terms of the taxonomy. */
export async function loadVisualStyles(ctx: ServiceContext): Promise<TaxonomyTerm[]> {
  const rows = await ctx.db
    .select({ code: schema.taxonomyTerms.code, label: schema.taxonomyTerms.label })
    .from(schema.taxonomyTerms)
    .where(
      and(eq(schema.taxonomyTerms.kind, "visual_style"), eq(schema.taxonomyTerms.isActive, true)),
    )
    .orderBy(asc(schema.taxonomyTerms.sortOrder), asc(schema.taxonomyTerms.code));
  return rows;
}

/** Library photos for the director: READY ones whose rights allow a visual transform (M3-16). */
export async function loadLibraryCandidates(ctx: ServiceContext): Promise<LibraryCandidate[]> {
  return listLibraryCandidates(ctx);
}
