import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../core";
import { getBrand, listAppSettings, setAppSetting, updateBrand, upsertTaxonomyTerm } from "./index";

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});
const visualSystem = {
  colors: {
    background: "#FFFFFF",
    surface: "#F4F1EC",
    text: "#1A1A1A",
    accent: "#C8553D",
    positive: "#2E7D32",
    negative: "#C62828",
  },
  fonts: { display: "display-serif", body: "body-sans" },
  logo: { assetKey: "brand/logo.svg", minHeightPx: 48 },
  spacing: { safeMarginPx: 64 },
};

describe("settings services", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let ownerId: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [owner] = await t.db.select().from(schema.appUsers);
    ownerId = owner?.id ?? "";
    ctx = createServiceContext({
      db: t.db,
      logger,
      actor: { type: "USER", userId: ownerId, role: "owner" },
    });
  });

  afterEach(async () => {
    await t.close();
  });

  const auditRows = () => t.db.select().from(schema.auditEvents).orderBy(schema.auditEvents.id);

  describe("updateBrand", () => {
    it("persists voice and visual system and audits the changed fields", async () => {
      const brand = await getBrand(ctx);
      const updated = await updateBrand(ctx, {
        brandId: brand.id,
        brandVoice: "# Voice\nWarm, precise.",
        visualSystem,
      });
      expect(updated.brandVoice).toBe("# Voice\nWarm, precise.");
      expect(updated.visualSystem).toEqual({ ...visualSystem, themeVariants: {} });
      expect(await auditRows()).toEqual([
        expect.objectContaining({
          action: "brand.updated",
          actorUserId: ownerId,
          entityId: brand.id,
          data: { fields: ["brandVoice", "visualSystem"] },
        }),
      ]);
    });

    it("rejects an invalid visual system with field paths and changes nothing", async () => {
      const brand = await getBrand(ctx);
      const error = await updateBrand(ctx, {
        brandId: brand.id,
        visualSystem: { ...visualSystem, colors: { ...visualSystem.colors, accent: "orange" } },
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(Object.keys((error as ValidationError).fieldErrors ?? {})).toEqual([
        "visualSystem.colors.accent",
      ]);
      expect((await getBrand(ctx)).visualSystem).toEqual({});
      expect(await auditRows()).toHaveLength(0);
    });
  });

  describe("upsertTaxonomyTerm", () => {
    it("adds and updates terms by (kind, code) with an audit row each time", async () => {
      await upsertTaxonomyTerm(ctx, {
        kind: "angle",
        code: "HOT_TAKE",
        label: "Hot take",
        isActive: true,
      });
      const term = await upsertTaxonomyTerm(ctx, {
        kind: "angle",
        code: "HOT_TAKE",
        label: "Hot take!",
        isActive: false,
      });
      expect(term).toMatchObject({ label: "Hot take!", isActive: false });
      const rows = await t.db
        .select()
        .from(schema.taxonomyTerms)
        .where(eq(schema.taxonomyTerms.code, "HOT_TAKE"));
      expect(rows).toHaveLength(1);
      expect((await auditRows()).map((r) => [r.action, r.data])).toEqual([
        [
          "settings.changed",
          { setting: "taxonomy", kind: "angle", termCode: "HOT_TAKE", isActive: true },
        ],
        [
          "settings.changed",
          { setting: "taxonomy", kind: "angle", termCode: "HOT_TAKE", isActive: false },
        ],
      ]);
    });

    it("requires UPPER_SNAKE codes and known kinds", async () => {
      await expect(
        upsertTaxonomyTerm(ctx, { kind: "angle", code: "hot-take", label: "x", isActive: true }),
      ).rejects.toThrow(/UPPER_SNAKE/);
      await expect(
        upsertTaxonomyTerm(ctx, { kind: "mood" as "angle", code: "X", label: "x", isActive: true }),
      ).rejects.toThrow();
    });
  });

  describe("setAppSetting", () => {
    it("stores typed values with the updater and audits from → to", async () => {
      await setAppSetting(ctx, { key: "publishing.min_gap_minutes", value: 240 });
      expect((await listAppSettings(ctx))["publishing.min_gap_minutes"]).toBe(240);
      const [row] = await t.db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "publishing.min_gap_minutes"));
      expect(row?.updatedBy).toBe(ownerId);
      expect((await auditRows()).at(-1)).toMatchObject({
        action: "settings.changed",
        data: { key: "publishing.min_gap_minutes", from: 180, to: 240 },
      });
    });

    it("rejects unknown keys and wrongly typed values", async () => {
      await expect(
        setAppSetting(ctx, { key: "ai.anything" as "publishing.enabled", value: 1 }),
      ).rejects.toThrow();
      await expect(
        setAppSetting(ctx, { key: "publishing.enabled", value: "yes" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        setAppSetting(ctx, { key: "publishing.min_gap_minutes", value: -5 }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(await auditRows()).toHaveLength(0);
    });
  });
});
