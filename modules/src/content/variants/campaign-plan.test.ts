import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planCampaign, shortVariantId } from "../../offers";
import { type ReviewFixture, reviewFixture } from "./test-support";

describe("planCampaign", () => {
  let t: TestDb;
  let fx: ReviewFixture;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reviewFixture(t.db);
  });
  afterEach(async () => {
    await t.close();
  });

  it("makes a new id for the market and the day, with the offer's landing page in the link", async () => {
    const { variantId } = await fx.makeVariant({ commercial: true, withOffer: true });
    const campaign = await planCampaign(fx.ctx, await fx.variant(variantId));
    expect(campaign.campaignId).toMatch(/^rc-es-261010-[a-z0-9]{6}$/);
    expect(campaign.utm).toMatchObject({
      source: "instagram",
      medium: "social",
      campaign: campaign.campaignId,
      content: shortVariantId(variantId),
    });
    expect(campaign.utm.url).toContain("https://example.test/guide?utm_source=instagram");
    // Nothing is written by planning.
    expect((await fx.variant(variantId)).campaignId).toBeNull();
  });

  it("keeps the id a variant already has", async () => {
    const { variantId } = await fx.makeVariant({ commercial: true, withOffer: true });
    await t.db
      .update(schema.contentVariants)
      .set({ campaignId: "rc-es-260101-aaaaaa" })
      .where(eq(schema.contentVariants.id, variantId));
    expect((await planCampaign(fx.ctx, await fx.variant(variantId))).campaignId).toBe(
      "rc-es-260101-aaaaaa",
    );
  });

  it("skips an id another variant has", async () => {
    const taken = await fx.makeVariant({ commercial: true, withOffer: true });
    await t.db
      .update(schema.contentVariants)
      .set({ campaignId: "rc-es-261010-abcdef" })
      .where(eq(schema.contentVariants.id, taken.variantId));
    const { variantId } = await fx.makeVariant({
      commercial: true,
      withOffer: true,
      marketCode: "en",
    });
    let calls = 0;
    // The first six draws spell the taken id (but for the market), the next six something else.
    const campaign = await planCampaign(
      { ...fx.ctx },
      { ...(await fx.variant(variantId)), campaignId: null },
      () => (calls++ < 6 ? calls - 1 : 30),
    );
    expect(campaign.campaignId).toBe(
      "rc-en-261010-444444".replace("444444", campaign.campaignId.slice(-6)),
    );
    expect(campaign.campaignId).not.toBe("rc-es-261010-abcdef");
  });
});
