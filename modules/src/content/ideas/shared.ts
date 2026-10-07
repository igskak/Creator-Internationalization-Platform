import { schema } from "@rc/db";
import { and, eq, inArray } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import type { ServiceContext } from "../../core";

// Rules shared by the manual and the generated ways to make an idea (plan 05 §5.6).

export const COMMERCIAL_INTENTS = ["NONE", "LEAD_MAGNET", "PRODUCT_SALE", "NURTURE"] as const;
export const MAX_LINKED_CARDS = 30;

export const KnowledgeLink = z.object({
  id: z.uuid(),
  role: z.enum(["PRIMARY", "SUPPORTING"]),
});
export type KnowledgeLink = z.infer<typeof KnowledgeLink>;

export const KnowledgeLinks = z.array(KnowledgeLink).min(1).max(MAX_LINKED_CARDS);

export type LinkRow = {
  knowledgeItemId: string;
  knowledgeVersion: number;
  role: "PRIMARY" | "SUPPORTING";
};

function fail(field: string, message: string): never {
  throw new ValidationError(message, { fieldErrors: { [field]: [message] } });
}

/** Category and angle must be active taxonomy codes. */
export async function assertTaxonomy(
  ctx: ServiceContext,
  codes: { category?: string; angle?: string },
): Promise<void> {
  const checks = [
    ["category", codes.category],
    ["angle", codes.angle],
  ] as const;
  for (const [kind, code] of checks) {
    if (code === undefined) continue;
    const [term] = await ctx.db
      .select({ code: schema.taxonomyTerms.code })
      .from(schema.taxonomyTerms)
      .where(
        and(
          eq(schema.taxonomyTerms.kind, kind),
          eq(schema.taxonomyTerms.code, code),
          eq(schema.taxonomyTerms.isActive, true),
        ),
      );
    if (!term) fail(kind, `"${code}" is not an active ${kind}.`);
  }
}

/** An idea sells something exactly when it has a product; the product must exist and be active. */
export async function assertProductAndIntent(
  ctx: ServiceContext,
  productId: string | null | undefined,
  intent: (typeof COMMERCIAL_INTENTS)[number],
): Promise<void> {
  if (productId) {
    const [product] = await ctx.db
      .select({ status: schema.products.status })
      .from(schema.products)
      .where(eq(schema.products.id, productId));
    if (!product) fail("productId", "This product does not exist.");
    if (product.status !== "ACTIVE") fail("productId", "This product is not active.");
  }
  if (intent !== "NONE" && !productId) {
    fail("productId", `The commercial intent ${intent} needs a product.`);
  }
  if (intent === "NONE" && productId) {
    fail("commercialIntent", "A product is set, so choose the commercial intent that fits it.");
  }
}

/**
 * Turns the chosen cards into link rows with the approved version used (lineage). At least one
 * PRIMARY card; each card once; every card must exist and be CHEF_APPROVED.
 */
export async function resolveApprovedLinks(
  ctx: ServiceContext,
  links: readonly KnowledgeLink[],
): Promise<LinkRow[]> {
  const ids = links.map((l) => l.id);
  if (new Set(ids).size !== ids.length) fail("knowledge", "A card is listed twice.");
  if (!links.some((l) => l.role === "PRIMARY")) {
    fail("knowledge", "Choose at least one primary card.");
  }
  const cards = await ctx.db
    .select({
      id: schema.knowledgeItems.id,
      title: schema.knowledgeItems.title,
      status: schema.knowledgeItems.reviewStatus,
      approvedVersion: schema.knowledgeItems.approvedVersion,
    })
    .from(schema.knowledgeItems)
    .where(inArray(schema.knowledgeItems.id, ids));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new NotFoundError("Some cards do not exist.", { details: { missing } });
  }
  const unapproved = cards.filter(
    (c) => c.status !== "CHEF_APPROVED" || c.approvedVersion === null,
  );
  if (unapproved.length > 0) {
    throw new InvalidStateError("Only approved cards can be used in an idea.", {
      details: { cards: unapproved.map((c) => ({ id: c.id, title: c.title, status: c.status })) },
    });
  }
  return links.map((l) => ({
    knowledgeItemId: l.id,
    knowledgeVersion: byId.get(l.id)?.approvedVersion ?? 1,
    role: l.role,
  }));
}
