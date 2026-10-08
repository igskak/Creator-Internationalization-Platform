import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../core";
import { getProductsOverview, upsertOffer, upsertProduct } from "./index";

// Integration tests for products and offers (plan 05 §5.5, M2-02). Synthetic content only.

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});
const rights: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "UNKNOWN",
};

describe("products and offers", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let brandId: string;
  let esId: string;
  let enId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [user] = await t.db.select().from(schema.appUsers);
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    ctx = createServiceContext({
      db: t.db,
      logger,
      actor: { type: "USER", userId: user?.id ?? "", role: "editor" },
    });
    const markets = await t.db.select().from(schema.markets);
    esId = markets.find((m) => m.code === "es-ES")?.id ?? "";
    enId = markets.find((m) => m.code === "en")?.id ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  const audits = async () => (await t.db.select().from(schema.auditEvents)).map((e) => e.action);
  const product = (over: Record<string, unknown> = {}) =>
    upsertProduct(ctx, {
      code: "GUIDE-PASTA",
      name: "Guía de pasta",
      type: "GUIDE",
      originalLanguage: "ru",
      ...over,
    });
  const offerInput = (productId: string, over: Record<string, unknown> = {}) => ({
    marketId: esId,
    productId,
    name: "Guía de pasta",
    type: "PAID_PRODUCT" as const,
    price: 19,
    currency: "EUR",
    landingUrl: "https://example.com/guia",
    defaultKeyword: "PASTA",
    priority: 5,
    status: "ACTIVE" as const,
    ...over,
  });

  describe("upsertProduct", () => {
    it("creates, then edits a product and audits only the changed fields", async () => {
      const created = await product();
      expect(created).toMatchObject({ code: "GUIDE-PASTA", status: "ACTIVE", brandId });
      const edited = await product({ id: created.id, name: "Guía de pasta 2", description: "x" });
      expect(edited.name).toBe("Guía de pasta 2");
      expect(await product({ id: created.id, name: "Guía de pasta 2", description: "x" })).toEqual(
        edited,
      );
      const events = await t.db.select().from(schema.auditEvents);
      expect(events.map((e) => e.action)).toEqual(["product.created", "product.updated"]);
      expect(events[1]?.data).toEqual({ fields: ["name", "description"] });
    });

    it("keeps the code unique, also against itself on edit", async () => {
      const first = await product();
      await expect(product({ name: "Other" })).rejects.toBeInstanceOf(ValidationError);
      const second = await product({ code: "GUIDE-RICE" });
      await expect(product({ id: second.id, code: first.code })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(product({ id: first.id })).resolves.toMatchObject({ id: first.id });
    });

    it("reports bad fields by name and saves nothing", async () => {
      const error = await product({ code: "bad code", originalLanguage: "russian" }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ValidationError);
      expect(Object.keys((error as ValidationError).fieldErrors ?? {})).toEqual(
        expect.arrayContaining(["code", "originalLanguage"]),
      );
      expect(await t.db.select().from(schema.products)).toHaveLength(0);
    });

    it("accepts only a product-material source", async () => {
      const [guide] = await t.db
        .insert(schema.sourceAssets)
        .values({ brandId, type: "GUIDE", title: "g", originalLanguage: "ru", rights })
        .returning();
      const [material] = await t.db
        .insert(schema.sourceAssets)
        .values({ brandId, type: "PRODUCT_MATERIAL", title: "m", originalLanguage: "ru", rights })
        .returning();
      await expect(product({ sourceAssetId: guide?.id })).rejects.toBeInstanceOf(ValidationError);
      await expect(product({ sourceAssetId: crypto.randomUUID() })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(product({ sourceAssetId: material?.id })).resolves.toMatchObject({
        sourceAssetId: material?.id,
      });
    });

    it("refuses to edit a product that does not exist", async () => {
      await expect(product({ id: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("upsertOffer", () => {
    it("creates an offer in the market currency without warnings and edits it", async () => {
      const p = await product();
      const { offer, warnings } = await upsertOffer(ctx, offerInput(p.id));
      expect(warnings).toEqual([]);
      expect(offer).toMatchObject({ price: "19.00", currency: "EUR", priority: 5 });
      const edited = await upsertOffer(ctx, offerInput(p.id, { id: offer.id, price: 24.5 }));
      expect(edited.offer.price).toBe("24.50");
      expect(await audits()).toEqual(["product.created", "offer.created", "offer.updated"]);
      const events = await t.db.select().from(schema.auditEvents);
      expect(events[2]).toMatchObject({ marketId: esId, data: { fields: ["price"], warnings: 0 } });
      const same = await upsertOffer(ctx, offerInput(p.id, { id: offer.id, price: 24.5 }));
      expect(same.offer.id).toBe(offer.id);
      expect(await audits()).toHaveLength(3);
    });

    it("saves another currency with a warning", async () => {
      const p = await product();
      const { offer, warnings } = await upsertOffer(
        ctx,
        offerInput(p.id, { currency: "usd", marketId: esId }),
      );
      expect(offer.currency).toBe("USD");
      expect(warnings).toEqual([
        { code: "CURRENCY_MISMATCH", currency: "USD", marketCode: "es-ES", marketCurrency: "EUR" },
      ]);
      const us = await upsertOffer(ctx, offerInput(p.id, { marketId: enId, currency: "USD" }));
      expect(us.warnings).toEqual([]);
    });

    it("requires https and a price for a paid offer, and a keyword without spaces", async () => {
      const p = await product();
      const fields = async (over: Record<string, unknown>) => {
        const error = await upsertOffer(ctx, offerInput(p.id, over)).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ValidationError);
        return Object.keys((error as ValidationError).fieldErrors ?? {});
      };
      expect(await fields({ landingUrl: "http://example.com/x" })).toContain("landingUrl");
      expect(await fields({ landingUrl: "not a url" })).toContain("landingUrl");
      expect(await fields({ price: null })).toEqual(["price"]);
      expect(await fields({ defaultKeyword: "two words" })).toContain("defaultKeyword");
      expect(await fields({ price: -1 })).toContain("price");
      expect(await t.db.select().from(schema.offers)).toHaveLength(0);
    });

    it("allows a free lead magnet and blank optional fields", async () => {
      const p = await product();
      const { offer } = await upsertOffer(
        ctx,
        offerInput(p.id, {
          type: "LEAD_MAGNET",
          price: null,
          landingUrl: "  ",
          defaultKeyword: "",
          status: "DRAFT",
        }),
      );
      expect(offer).toMatchObject({ price: null, landingUrl: null, defaultKeyword: null });
    });

    it("warns about an active offer without a landing page", async () => {
      const p = await product();
      const { warnings } = await upsertOffer(ctx, offerInput(p.id, { landingUrl: null }));
      expect(warnings).toEqual([{ code: "NO_LANDING_URL" }]);
    });

    it("refuses an unknown market, product or offer", async () => {
      const p = await product();
      await expect(
        upsertOffer(ctx, offerInput(p.id, { marketId: crypto.randomUUID() })),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(upsertOffer(ctx, offerInput(crypto.randomUUID()))).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        upsertOffer(ctx, offerInput(p.id, { id: crypto.randomUUID() })),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("lists products with their offers per market, markets and product materials", async () => {
    const a = await product();
    const b = await product({ code: "OLD", name: "Old", status: "INACTIVE" });
    await upsertOffer(ctx, offerInput(a.id, { name: "ES", priority: 2 }));
    await upsertOffer(ctx, offerInput(a.id, { name: "EN", marketId: enId, currency: "USD" }));
    await t.db
      .insert(schema.sourceAssets)
      .values({ brandId, type: "PRODUCT_MATERIAL", title: "m", originalLanguage: "ru", rights });
    const overview = await getProductsOverview(ctx);
    expect(overview.products.map((p) => p.code)).toEqual(["GUIDE-PASTA", "OLD"]);
    expect(overview.products[0]?.offers.map((o) => [o.marketCode, o.name])).toEqual([
      ["es-ES", "ES"],
      ["en", "EN"],
    ]);
    expect(overview.products[1]?.id).toBe(b.id);
    expect(overview.products[1]?.offers).toEqual([]);
    expect(overview.markets.map((m) => m.code)).toContain("es-ES");
    expect(overview.materials).toEqual([{ id: expect.any(String), title: "m" }]);
  });
});
