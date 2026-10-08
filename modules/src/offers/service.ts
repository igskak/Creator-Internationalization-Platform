import { schema } from "@rc/db";
import { and, asc, eq, isNull, ne } from "@rc/db/orm";
import { InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../core";

// Products and market offers (plan 05 §5.5, M2-02). A product is the Reg.Chef original; an offer
// is what is sold in one market, with its own price, currency, landing page and priority.

type Product = typeof schema.products.$inferSelect;
type Offer = typeof schema.offers.$inferSelect;

export const PRODUCT_TYPES = ["GUIDE", "RECIPE_COLLECTION", "COURSE", "BUNDLE", "OTHER"] as const;
export const PRODUCT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const OFFER_TYPES = ["LEAD_MAGNET", "PAID_PRODUCT", "BUNDLE"] as const;
export const OFFER_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "RETIRED"] as const;

const parse = <S extends z.ZodType>(input: S, raw: unknown): z.output<S> => {
  const parsed = input.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
};

function fail(field: string, message: string): never {
  throw new ValidationError(message, { fieldErrors: { [field]: [message] } });
}

/** A blank optional text field means "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const text = (max: number) => z.string().trim().min(1).max(max);

export const UpsertProductInput = z.object({
  id: z.uuid().optional(),
  /** Stable short code, e.g. "CHEF-GUIDE-PASTA". */
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, digits, dots, dashes and underscores."),
  name: text(200),
  type: z.enum(PRODUCT_TYPES),
  description: optionalText(2000),
  /** ISO 639-1. */
  originalLanguage: z
    .string()
    .trim()
    .regex(/^[a-z]{2}$/, "Use a two-letter language code, e.g. ru."),
  /** A PRODUCT_MATERIAL source. */
  sourceAssetId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  status: z.enum(PRODUCT_STATUSES).default("ACTIVE"),
});

/** Adds or edits a product (owner, editor). `code` is unique. */
export async function upsertProduct(
  ctx: ServiceContext,
  raw: z.input<typeof UpsertProductInput>,
): Promise<Product> {
  const { id, ...input } = parse(UpsertProductInput, raw);

  if (input.sourceAssetId) {
    const [source] = await ctx.db
      .select({ type: schema.sourceAssets.type })
      .from(schema.sourceAssets)
      .where(eq(schema.sourceAssets.id, input.sourceAssetId));
    if (!source) fail("sourceAssetId", "This source does not exist.");
    if (source.type !== "PRODUCT_MATERIAL") {
      fail("sourceAssetId", "Choose a source of the type product material.");
    }
  }

  return withTransaction(ctx, async (tx) => {
    const [same] = await tx.db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(
        id
          ? and(eq(schema.products.code, input.code), ne(schema.products.id, id))
          : eq(schema.products.code, input.code),
      );
    if (same) {
      fail("code", "Another product already uses this code.");
    }

    if (!id) {
      const [brand] = await tx.db.select({ id: schema.brands.id }).from(schema.brands).limit(1);
      if (!brand) throw new InvalidStateError("No brand is set up.");
      const [created] = await tx.db
        .insert(schema.products)
        .values({ brandId: brand.id, ...input })
        .returning();
      if (!created) throw new Error("Insert returned no row.");
      await audit(tx, {
        action: "product.created",
        entityType: "product",
        entityId: created.id,
        data: { code: created.code, type: created.type },
      });
      return created;
    }

    const [current] = await tx.db.select().from(schema.products).where(eq(schema.products.id, id));
    if (!current) throw new NotFoundError("Product not found.", { details: { id } });
    const changed = (Object.keys(input) as (keyof typeof input)[]).filter(
      (field) => input[field] !== current[field],
    );
    if (changed.length === 0) return current;
    const [row] = await tx.db
      .update(schema.products)
      .set(input)
      .where(eq(schema.products.id, id))
      .returning();
    if (!row) throw new NotFoundError("Product not found.", { details: { id } });
    await audit(tx, {
      action: "product.updated",
      entityType: "product",
      entityId: id,
      data: { fields: changed },
    });
    return row;
  });
}

/** ISO 4217 shape; the markets table decides which one a market uses. */
const Currency = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code, e.g. EUR."));

const HttpsUrl = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null))
  .superRefine((value, ctx) => {
    if (value === null) return;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !url.hostname.includes(".")) throw new Error("not https");
    } catch {
      ctx.addIssue({ code: "custom", message: "Use a full https:// address." });
    }
  });

export const UpsertOfferInput = z.object({
  id: z.uuid().optional(),
  marketId: z.uuid(),
  productId: z.uuid(),
  name: text(200),
  type: z.enum(OFFER_TYPES),
  /** Absent for a free lead magnet. */
  price: z
    .number()
    .min(0)
    .max(1_000_000)
    .multipleOf(0.01)
    .nullish()
    .transform((v) => v ?? null),
  currency: Currency,
  landingUrl: HttpsUrl,
  /** Suggested ManyChat keyword: one word, no spaces. */
  defaultKeyword: z
    .string()
    .trim()
    .max(40)
    .regex(/^\S*$/, "A keyword is a single word, without spaces.")
    .nullish()
    .transform((v) => (v ? v : null)),
  /** Higher first when the idea generator picks offers [S§7.2]. */
  priority: z.number().int().min(0).max(1000).default(0),
  status: z.enum(OFFER_STATUSES).default("DRAFT"),
});

/** Things worth a second look that do not block saving; the screen words them. */
export type OfferWarning =
  | { code: "CURRENCY_MISMATCH"; currency: string; marketCode: string; marketCurrency: string }
  | { code: "NO_LANDING_URL" };

export type UpsertOfferResult = { offer: Offer; warnings: OfferWarning[] };

/**
 * Adds or edits a market offer (owner, editor). The currency should be the market's; another one
 * is saved with a warning (plan 05 §5.5). The landing URL must be https. A paid offer needs a price.
 */
export async function upsertOffer(
  ctx: ServiceContext,
  raw: z.input<typeof UpsertOfferInput>,
): Promise<UpsertOfferResult> {
  const { id, ...input } = parse(UpsertOfferInput, raw);
  if (input.type === "PAID_PRODUCT" && input.price === null) {
    fail("price", "A paid offer needs a price.");
  }

  return withTransaction(ctx, async (tx) => {
    const [market] = await tx.db
      .select({
        id: schema.markets.id,
        code: schema.markets.code,
        currency: schema.markets.currency,
      })
      .from(schema.markets)
      .where(eq(schema.markets.id, input.marketId));
    if (!market) fail("marketId", "This market does not exist.");
    const [product] = await tx.db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.id, input.productId));
    if (!product) fail("productId", "This product does not exist.");

    const warnings: OfferWarning[] = [];
    if (input.currency !== market.currency) {
      warnings.push({
        code: "CURRENCY_MISMATCH",
        currency: input.currency,
        marketCode: market.code,
        marketCurrency: market.currency,
      });
    }
    if (input.status === "ACTIVE" && !input.landingUrl) warnings.push({ code: "NO_LANDING_URL" });
    const values = { ...input, price: input.price === null ? null : input.price.toFixed(2) };

    if (!id) {
      const [created] = await tx.db.insert(schema.offers).values(values).returning();
      if (!created) throw new Error("Insert returned no row.");
      await audit(tx, {
        action: "offer.created",
        entityType: "offer",
        entityId: created.id,
        marketId: created.marketId,
        data: { type: created.type, status: created.status, warnings: warnings.length },
      });
      return { offer: created, warnings };
    }

    const [current] = await tx.db.select().from(schema.offers).where(eq(schema.offers.id, id));
    if (!current) throw new NotFoundError("Offer not found.", { details: { id } });
    const changed = (Object.keys(values) as (keyof typeof values)[]).filter(
      (field) => values[field] !== current[field],
    );
    if (changed.length === 0) return { offer: current, warnings };
    const [row] = await tx.db
      .update(schema.offers)
      .set(values)
      .where(eq(schema.offers.id, id))
      .returning();
    if (!row) throw new NotFoundError("Offer not found.", { details: { id } });
    await audit(tx, {
      action: "offer.updated",
      entityType: "offer",
      entityId: id,
      marketId: row.marketId,
      data: { fields: changed, warnings: warnings.length },
    });
    return { offer: row, warnings };
  });
}

export type OfferRow = Pick<
  Offer,
  | "id"
  | "marketId"
  | "productId"
  | "name"
  | "type"
  | "price"
  | "currency"
  | "landingUrl"
  | "defaultKeyword"
  | "priority"
  | "status"
> & { marketCode: string; marketCurrency: string };

export type ProductWithOffers = Product & { offers: OfferRow[] };

export type ProductsOverview = {
  products: ProductWithOffers[];
  markets: { id: string; code: string; displayName: string; currency: string; isActive: boolean }[];
  /** PRODUCT_MATERIAL sources a product can point at. */
  materials: { id: string; title: string }[];
};

/** Everything the offers screen shows: products with their offers, markets, product materials. */
export async function getProductsOverview(ctx: ServiceContext): Promise<ProductsOverview> {
  const [products, offers, markets, materials] = await Promise.all([
    ctx.db
      .select()
      .from(schema.products)
      .orderBy(asc(schema.products.status), asc(schema.products.name), asc(schema.products.code)),
    ctx.db
      .select({
        id: schema.offers.id,
        marketId: schema.offers.marketId,
        productId: schema.offers.productId,
        name: schema.offers.name,
        type: schema.offers.type,
        price: schema.offers.price,
        currency: schema.offers.currency,
        landingUrl: schema.offers.landingUrl,
        defaultKeyword: schema.offers.defaultKeyword,
        priority: schema.offers.priority,
        status: schema.offers.status,
        marketCode: schema.markets.code,
        marketCurrency: schema.markets.currency,
      })
      .from(schema.offers)
      .innerJoin(schema.markets, eq(schema.markets.id, schema.offers.marketId))
      .orderBy(
        asc(schema.markets.sortOrder),
        asc(schema.offers.priority),
        asc(schema.offers.name),
        asc(schema.offers.id),
      ),
    ctx.db
      .select({
        id: schema.markets.id,
        code: schema.markets.code,
        displayName: schema.markets.displayName,
        currency: schema.markets.currency,
        isActive: schema.markets.isActive,
      })
      .from(schema.markets)
      .orderBy(asc(schema.markets.sortOrder), asc(schema.markets.code)),
    ctx.db
      .select({ id: schema.sourceAssets.id, title: schema.sourceAssets.title })
      .from(schema.sourceAssets)
      .where(
        and(
          eq(schema.sourceAssets.type, "PRODUCT_MATERIAL"),
          isNull(schema.sourceAssets.archivedAt),
        ),
      )
      .orderBy(asc(schema.sourceAssets.title)),
  ]);
  return {
    products: products.map((p) => ({ ...p, offers: offers.filter((o) => o.productId === p.id) })),
    markets,
    materials,
  };
}
