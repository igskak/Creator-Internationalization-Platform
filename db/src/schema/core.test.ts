import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VisualSystem } from "../json";
import { createTestDb, type TestDb } from "../test-db";
import { appSettings, appUsers, auditEvents, brands, markets, taxonomyTerms } from "./core";

// Synthetic data only.
const visualSystem: VisualSystem = {
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
  themeVariants: { "warm-mediterranean": { accent: "#D98E04" } },
};

describe("0001_core", () => {
  let t: TestDb;
  let brandId: string;

  beforeAll(async () => {
    t = await createTestDb();
    const [brand] = await t.db
      .insert(brands)
      .values({ slug: "test-brand", name: "Test Brand", brandVoice: "# Voice", visualSystem })
      .returning();
    brandId = brand?.id ?? "";
  });

  afterAll(async () => {
    await t.close();
  });

  it("enables RLS on every core table", async () => {
    const result = await t.db.execute<{ relname: string; relrowsecurity: boolean }>(sql`
      select relname, relrowsecurity from pg_class
      where relname in ('app_users','brands','markets','taxonomy_terms','app_settings','audit_events')
      order by relname`);
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("round-trips a brand with its visual system", async () => {
    const [brand] = await t.db.select().from(brands).where(eq(brands.id, brandId));
    expect(brand).toMatchObject({ slug: "test-brand", brandVoice: "# Voice", visualSystem });
    expect(brand?.createdAt).toBeInstanceOf(Date);
  });

  it("defaults visual_system to an empty object", async () => {
    const [brand] = await t.db.insert(brands).values({ slug: "bare", name: "Bare" }).returning();
    expect(brand?.visualSystem).toEqual({});
  });

  it("round-trips a market with enums, defaults and JSON arrays", async () => {
    const [market] = await t.db
      .insert(markets)
      .values({
        brandId,
        code: "es-ES",
        displayName: "Spain",
        flagEmoji: "🇪🇸",
        country: "ES",
        language: "es",
        currency: "EUR",
        timezone: "Europe/Madrid",
        measurementSystem: "METRIC",
        preferredVocabulary: [{ concept: "shrimp", preferred: "gamba", avoid: ["camarón"] }],
        forbiddenPatterns: [{ pattern: "\\bcamar[oó]n\\b", kind: "REGEX", reason: "LatAm term" }],
        visualHypotheses: [
          {
            id: "h1",
            description: "Warm tones",
            visualStyle: "WARM_MEDITERRANEAN",
            status: "UNTESTED",
          },
        ],
        isActive: true,
      })
      .returning();
    expect(market).toMatchObject({
      code: "es-ES",
      currency: "EUR",
      measurementSystem: "METRIC",
      foodCultureNotes: "",
      sortOrder: 0,
      preferredVocabulary: [{ concept: "shrimp", preferred: "gamba", avoid: ["camarón"] }],
    });
    expect(market?.forbiddenPatterns[0]?.kind).toBe("REGEX");
  });

  it("requires markets to belong to an existing brand", async () => {
    await expect(
      t.db.insert(markets).values({
        brandId: "00000000-0000-0000-0000-000000000000",
        code: "xx",
        displayName: "X",
        country: "GLOBAL",
        language: "en",
        currency: "USD",
        timezone: "UTC",
        measurementSystem: "DUAL",
      }),
    ).rejects.toThrow();
  });

  it("keeps user emails unique regardless of case and defaults the role", async () => {
    const [user] = await t.db.insert(appUsers).values({ email: "owner@example.com" }).returning();
    expect(user).toMatchObject({ role: "editor", isActive: true, authUserId: null });
    await expect(t.db.insert(appUsers).values({ email: "Owner@Example.com" })).rejects.toThrow();
  });

  it("checks taxonomy kinds and (kind, code) uniqueness", async () => {
    await t.db
      .insert(taxonomyTerms)
      .values({ kind: "angle", code: "QUICK_TIP", label: "Quick tip" });
    await expect(
      t.db.insert(taxonomyTerms).values({ kind: "angle", code: "QUICK_TIP", label: "Again" }),
    ).rejects.toThrow();
    await t.db.insert(taxonomyTerms).values({ kind: "hook_type", code: "QUICK_TIP", label: "Ok" });
    await expect(
      t.db.execute(sql`insert into taxonomy_terms (kind, code, label) values ('mood', 'X', 'X')`),
    ).rejects.toThrow();
  });

  it("updates updated_at through the trigger", async () => {
    const old = new Date("2020-01-01T00:00:00Z");
    const [term] = await t.db
      .insert(taxonomyTerms)
      .values({ kind: "category", code: "EGGS", label: "Eggs", createdAt: old, updatedAt: old })
      .returning();
    const [updated] = await t.db
      .update(taxonomyTerms)
      .set({ label: "Eggs & omelettes" })
      .where(eq(taxonomyTerms.id, term?.id ?? ""))
      .returning();
    expect(updated?.createdAt).toEqual(old);
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it("stores app settings as JSON with an updater", async () => {
    const [user] = await t.db.insert(appUsers).values({ email: "editor@example.com" }).returning();
    await t.db
      .insert(appSettings)
      .values({ key: "publishing.min_gap_minutes", value: 180, updatedBy: user?.id ?? null });
    const [setting] = await t.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "publishing.min_gap_minutes"));
    expect(setting?.value).toBe(180);
  });

  it("appends audit events with identity ids and default data", async () => {
    const [first] = await t.db
      .insert(auditEvents)
      .values({
        actorType: "SYSTEM",
        action: "brand.updated",
        entityType: "brand",
        entityId: brandId,
      })
      .returning();
    const [second] = await t.db
      .insert(auditEvents)
      .values({
        actorType: "JOB",
        action: "market.updated",
        entityType: "market",
        data: { field: "tone_notes" },
        requestId: "req-1",
      })
      .returning();
    expect(first?.data).toEqual({});
    expect(typeof first?.id).toBe("number");
    expect((second?.id ?? 0) > (first?.id ?? 0)).toBe(true);
    await expect(
      t.db.execute(
        sql`insert into audit_events (id, actor_type, action, entity_type) values (999, 'USER', 'x', 'y')`,
      ),
    ).rejects.toThrow();
  });
});
