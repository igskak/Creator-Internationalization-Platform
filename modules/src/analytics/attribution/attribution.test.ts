import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ForbiddenError, ValidationError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ReviewFixture,
  recordingJobs,
  reviewFixture,
} from "../../content/variants/test-support";
import { getCommercial } from "../queries";
import {
  AttributionFileError,
  createAttributionImport,
  deleteAttributionEvent,
  importAttributionCsv,
  listAttributionImports,
  listUnknownCampaigns,
  parseAttributionCsv,
  reassignCampaign,
  recordAttributionEvent,
  toAmount,
  toInstant,
} from "./index";

// M6-08: leads and sales typed in or imported, reconciliation of unknown campaign ids, and the
// Commercial numbers on a fixture with known answers. Synthetic data only.

describe("parseAttributionCsv", () => {
  it("reads the known column names in any case, with ; and a BOM", () => {
    const csv =
      "﻿Event;Date;UTM Campaign;Order ID;Amount;Currency;Qty;utm_source;Email\n" +
      "sale;2026-10-02 10:30;RC-ES-261001-abc123;A-1;19,90;eur;1;instagram;ana@example.com\n" +
      "lead;2026-10-03;rc-es-261001-abc123;;;;3;;bob@example.com\n";
    const { rows, errors, totalRows } = parseAttributionCsv(csv);
    expect(errors).toEqual([]);
    expect(totalRows).toBe(2);
    expect(rows[0]).toEqual({
      row: 2,
      type: "SALE",
      occurredAt: "2026-10-02T10:30:00.000Z",
      campaignId: "rc-es-261001-abc123",
      market: null,
      quantity: 1,
      amount: "19.90",
      currency: "EUR",
      externalRef: "A-1",
      utm: { source: "instagram" },
    });
    expect(rows[1]).toMatchObject({ type: "LEAD", quantity: 3, amount: null, currency: null });
    // No order id: a hash of the row, never the e-mail (the column is not read at all).
    expect(rows[1]?.externalRef).toMatch(/^row:[0-9a-f]{32}$/u);
    expect(JSON.stringify(rows)).not.toContain("example.com");
  });

  it("hashes an e-mail or a phone used as the order id", () => {
    const { rows } = parseAttributionCsv(
      "type,date,order id\nlead,2026-10-01,ana@example.com\nlead,2026-10-01,+34 600 123 456\n",
    );
    expect(rows.map((r) => r.externalRef)).toEqual([
      expect.stringMatching(/^hash:[0-9a-f]{64}$/u),
      expect.stringMatching(/^hash:[0-9a-f]{64}$/u),
    ]);
  });

  it("gives the same reference to the same row twice, and different ones to equal rows", () => {
    const csv =
      "type,date,campaign\nlead,2026-10-01,rc-es-261001-abc123\nlead,2026-10-01,rc-es-261001-abc123\n";
    const first = parseAttributionCsv(csv).rows.map((r) => r.externalRef);
    const again = parseAttributionCsv(csv).rows.map((r) => r.externalRef);
    expect(first).toEqual(again);
    expect(first[0]).not.toBe(first[1]);
  });

  it("takes a mapping for columns with other names", () => {
    const { rows } = parseAttributionCsv(
      "Kind,When,Flow,Total\nSALE,2026-10-01,rc-en-261001-zzz999,5\n",
      {
        type: "Kind",
        occurredAt: "When",
        campaignId: "Flow",
      },
    );
    expect(rows[0]).toMatchObject({
      type: "SALE",
      campaignId: "rc-en-261001-zzz999",
      amount: "5.00",
    });
  });

  it("reports bad rows with their row number and keeps the good ones", () => {
    const csv = [
      "type,date,amount,quantity,currency",
      "visit,2026-10-01,,,", // bad type
      "sale,yesterday,10,,", // bad date
      "sale,2026-10-01,,,", // a sale without an amount
      "sale,2026-10-01,-3,,", // a negative amount
      "lead,2026-10-01,,0,", // quantity 0
      "sale,2026-10-01,3,,EURO", // bad currency
      "lead,01.10.2026,,,", // fine
    ].join("\n");
    const { rows, errors } = parseAttributionCsv(csv);
    expect(errors.map((e) => [e.row, e.field])).toEqual([
      [2, "type"],
      [3, "occurredAt"],
      [4, "amount"],
      [5, "amount"],
      [6, "quantity"],
      [7, "currency"],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurredAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("refuses a file without the needed columns or rows", () => {
    expect(() => parseAttributionCsv("campaign,amount\nx,1\n")).toThrow(AttributionFileError);
    expect(() => parseAttributionCsv("type,date\n")).toThrow(AttributionFileError);
  });

  it("reads sums and dates in the usual spellings", () => {
    expect(
      ["12", "12.5", "12,50", "1 234,50", "1.234,50", "1,234.50", "€9.99"].map(toAmount),
    ).toEqual(["12.00", "12.50", "12.50", "1234.50", "1234.50", "1234.50", "9.99"]);
    expect(toAmount("abc")).toBeNull();
    expect(toInstant("2026-10-01T10:00:00+02:00")).toBe("2026-10-01T08:00:00.000Z");
    expect(toInstant("10/01/2026")).toBeNull();
  });
});

describe("attribution events", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  let jobs: ReturnType<typeof recordingJobs>;
  const marketIds: Record<string, string> = {};
  const WINDOW = { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" };

  beforeEach(async () => {
    jobs = recordingJobs();
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reviewFixture(t.db, { jobs: jobs.runner });
    for (const m of await t.db.select().from(schema.markets)) marketIds[m.code] = m.id;
  });
  afterEach(async () => {
    await t.close();
  });

  /** A published commercial post with an offer, a campaign id and a D7 reach. */
  async function campaignPost(campaignId: string, market: "es-ES" | "en", reach: number | null) {
    const { variantId } = await fx.makeVariant({
      status: "PUBLISHED",
      marketCode: market,
      commercial: true,
      withOffer: true,
    });
    await t.db
      .update(schema.contentVariants)
      .set({ campaignId, hook: `Hook ${campaignId}` })
      .where(eq(schema.contentVariants.id, variantId));
    const { versionId } = await fx.makeVersion(variantId);
    const publicationId = await fx.makePublication(variantId, versionId, {
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      publishedAt: new Date("2026-10-02T09:00:00Z"),
    });
    if (reach !== null) {
      await t.db.insert(schema.metricSnapshots).values({
        publicationId,
        snapshotSlot: "D7",
        measuredAt: new Date("2026-10-09T09:00:00Z"),
        mediaAgeHours: "168",
        reach,
        rawMetricsJson: {},
        apiVersion: "v25.0",
      });
    }
    return { variantId, publicationId };
  }

  async function runImport(text: string) {
    const { batchId } = await createAttributionImport(fx.ctx, { fileName: "orders.csv", text });
    const job = jobs.calls.at(-1);
    expect(job?.name).toBe("import-attribution-csv");
    expect(job?.options?.idempotencyKey).toBe(`attribution-import:${batchId}`);
    return importAttributionCsv(fx.ctx, job?.payload as never);
  }

  it("imports a file, dedupes by reference on a second import, and lists both imports", async () => {
    await campaignPost("rc-es-261001-abc123", "es-ES", 2000);
    const csv =
      "type,date,campaign,order id,amount\n" +
      "sale,2026-10-03,rc-es-261001-abc123,A-1,20\n" +
      "sale,2026-10-03,rc-es-261001-abc123,A-1,20\n" + // the same order twice in one file
      "lead,2026-10-03,rc-es-261001-abc123,,\n" +
      "lead,2026-10-04,rc-xx-261001-nope00,,\n"; // unknown campaign, unknown market
    const first = await runImport(csv);
    expect(first).toMatchObject({
      totalRows: 4,
      created: 2,
      duplicates: 1,
      unknownCampaigns: 0,
      errorCount: 1,
    });
    expect(first.errors[0]).toMatchObject({ row: 5, field: "market" });
    const again = await runImport(csv);
    expect(again).toMatchObject({ created: 0, duplicates: 3 });
    const events = await t.db.select().from(schema.attributionEvents);
    expect(events).toHaveLength(2);
    // The sale took the market and the offer of the campaign's post, and the market's currency.
    const sale = events.find((e) => e.type === "SALE");
    expect(sale).toMatchObject({
      marketId: marketIds["es-ES"],
      currency: "EUR",
      source: "CSV_IMPORT",
    });
    expect(sale?.offerId).not.toBeNull();
    const imports = await listAttributionImports(fx.ctx);
    expect(imports).toHaveLength(2);
    expect(imports[0]?.fileName).toBe("orders.csv");
    expect(imports.every((i) => i.report !== null)).toBe(true);
  });

  it("refuses a file without the needed columns before it is stored", async () => {
    await expect(
      createAttributionImport(fx.ctx, { fileName: "x.csv", text: "campaign\nrc\n" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createAttributionImport(fx.ctx, { fileName: "x.xlsx", text: "type,date\nlead,2026-10-01\n" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(jobs.calls).toHaveLength(0);
  });

  it("records a manual event, takes the market from the campaign id, and lists unknown ids", async () => {
    await recordAttributionEvent(fx.ctx, {
      type: "SALE",
      occurredAt: "2026-10-05T12:00:00Z",
      campaignId: "rc-en-261001-typo00",
      amount: 30,
    });
    await recordAttributionEvent(fx.ctx, {
      type: "LEAD",
      occurredAt: "2026-10-05T12:00:00Z",
      campaignId: "rc-en-261001-typo00",
      quantity: 2,
    });
    const [sale] = await t.db
      .select()
      .from(schema.attributionEvents)
      .where(eq(schema.attributionEvents.type, "SALE"));
    expect(sale).toMatchObject({ marketId: marketIds.en, currency: "USD", amount: "30.00" });
    const unknown = await listUnknownCampaigns(fx.ctx);
    expect(unknown).toEqual([
      expect.objectContaining({
        campaignId: "rc-en-261001-typo00",
        marketCode: "en",
        events: 2,
        leads: 2,
        sales: 1,
      }),
    ]);

    // A campaign id with no market part needs a market.
    await expect(
      recordAttributionEvent(fx.ctx, {
        type: "LEAD",
        occurredAt: "2026-10-05T12:00:00Z",
        campaignId: "spring",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // A sale needs its amount; an e-mail is not an order id.
    await expect(
      recordAttributionEvent(fx.ctx, {
        type: "SALE",
        occurredAt: "2026-10-05T12:00:00Z",
        marketId: marketIds.en,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordAttributionEvent(fx.ctx, {
        type: "LEAD",
        occurredAt: "2026-10-05T12:00:00Z",
        marketId: marketIds.en,
        externalRef: "a@b.c",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // A chef cannot record money.
    await expect(
      recordAttributionEvent(fx.as("chef"), {
        type: "LEAD",
        occurredAt: "2026-10-05T12:00:00Z",
        marketId: marketIds.en,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reassigns an unknown id to a post's campaign, which then counts on the Commercial tab", async () => {
    await campaignPost("rc-en-261001-good00", "en", 1000);
    await recordAttributionEvent(fx.ctx, {
      type: "SALE",
      occurredAt: "2026-10-05T12:00:00Z",
      campaignId: "rc-en-261001-typo00",
      amount: 30,
    });
    await expect(
      reassignCampaign(fx.ctx, { from: "rc-en-261001-typo00", to: "rc-en-261001-none00" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      await reassignCampaign(fx.ctx, { from: "rc-en-261001-typo00", to: "rc-en-261001-good00" }),
    ).toEqual({
      moved: 1,
    });
    expect(await listUnknownCampaigns(fx.ctx)).toEqual([]);
    const c = await getCommercial(fx.ctx, WINDOW);
    expect(c.campaigns[0]).toMatchObject({
      campaignId: "rc-en-261001-good00",
      known: true,
      sales: 1,
    });
  });

  it("deletes an event (owners only) and audits it", async () => {
    const { id } = await recordAttributionEvent(fx.ctx, {
      type: "LEAD",
      occurredAt: "2026-10-05T12:00:00Z",
      marketId: marketIds.en,
    });
    await expect(deleteAttributionEvent(fx.as("editor"), { id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await deleteAttributionEvent(fx.ctx, { id });
    expect(await t.db.select().from(schema.attributionEvents)).toEqual([]);
    const actions = (await t.db.select().from(schema.auditEvents)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["attribution.recorded", "attribution.deleted"]),
    );
  });

  describe("getCommercial", () => {
    it("sums leads, sales and revenue per campaign, offer and market, with revenue per 1,000 reach", async () => {
      await campaignPost("rc-es-261001-aaa111", "es-ES", 2000);
      await campaignPost("rc-es-261001-bbb222", "es-ES", null); // no numbers yet
      await campaignPost("rc-en-261001-ccc333", "en", 500);
      const csv = [
        "type,date,campaign,order id,amount,quantity",
        "lead,2026-10-03,rc-es-261001-aaa111,,,4",
        "sale,2026-10-03,rc-es-261001-aaa111,E1,50,1",
        "sale,2026-10-04,rc-es-261001-aaa111,E2,30,1",
        "refund,2026-10-05,rc-es-261001-aaa111,E2R,30,1",
        "sale,2026-10-06,rc-es-261001-bbb222,E3,10,1",
        "sale,2026-10-06,rc-en-261001-ccc333,U1,25,1",
        "lead,2026-10-06,rc-en-261001-ccc333,,,1",
        "sale,2026-09-20,rc-es-261001-aaa111,OLD,999,1", // before the window
        "lead,2026-10-07,,,,2", // no campaign
      ].join("\n");
      const report = await runImport(csv);
      // The row without a campaign has no market and is refused: type it in by hand.
      expect(report.errors).toEqual([expect.objectContaining({ row: 10, field: "market" })]);
      await recordAttributionEvent(fx.ctx, {
        type: "LEAD",
        occurredAt: "2026-10-07T00:00:00Z",
        marketId: marketIds["es-ES"],
        quantity: 2,
      });
      const c = await getCommercial(fx.ctx, WINDOW);
      expect(c.totals).toMatchObject({ leads: 7, sales: 4, refunds: 1 });
      expect(c.totals.revenue).toEqual([
        { currency: "EUR", amount: 60 },
        { currency: "USD", amount: 25 },
      ]);
      // Per 1,000 reach over the campaigns with reach only: aaa (50 € on 2000) and ccc (25 $ on 500).
      expect(c.totals.reachD7).toBe(2500);
      expect(c.totals.revenuePer1kReach).toEqual([
        { currency: "EUR", amount: 20 },
        { currency: "USD", amount: 10 },
      ]);
      const aaa = c.campaigns.find((x) => x.campaignId === "rc-es-261001-aaa111");
      expect(aaa).toMatchObject({
        leads: 4,
        sales: 2,
        refunds: 1,
        revenue: [{ currency: "EUR", amount: 50 }],
        reachD7: 2000,
        revenuePer1kReach: [{ currency: "EUR", amount: 25 }],
        known: true,
        hook: "Hook rc-es-261001-aaa111",
        offerName: "Guide",
      });
      expect(aaa?.publicationId).toBeTruthy();
      const bbb = c.campaigns.find((x) => x.campaignId === "rc-es-261001-bbb222");
      expect(bbb).toMatchObject({ reachD7: null, revenuePer1kReach: null });
      expect(c.campaigns.find((x) => x.campaignId === null)).toMatchObject({
        leads: 2,
        known: false,
      });
      expect(c.markets).toEqual([
        expect.objectContaining({ marketCode: "en", leads: 1, sales: 1 }),
        expect.objectContaining({ marketCode: "es-ES", leads: 6, sales: 3 }),
      ]);
      expect(c.offers.reduce((s, o) => s + o.sales, 0)).toBe(4);

      const onlyEn = await getCommercial(fx.ctx, { ...WINDOW, marketId: marketIds.en });
      expect(onlyEn.totals).toMatchObject({
        leads: 1,
        sales: 1,
        revenue: [{ currency: "USD", amount: 25 }],
      });
    });

    it("answers with zeros and no rate when nothing was recorded", async () => {
      const c = await getCommercial(fx.ctx, WINDOW);
      expect(c.totals).toEqual({
        leads: 0,
        sales: 0,
        refunds: 0,
        revenue: [],
        reachD7: null,
        revenuePer1kReach: null,
      });
      expect(c.campaigns).toEqual([]);
    });
  });
});
