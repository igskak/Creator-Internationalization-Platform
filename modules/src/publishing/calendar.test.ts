import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approveVariant } from "../content";
import { type ReviewFixture, reviewFixture } from "../content/variants/test-support";
import { getCalendar, listApprovedNotScheduled } from "./calendar";
import { cancelPublication, schedulePublication } from "./schedule";

// The calendar's reads (M4-09).

const NOW = Date.parse("2026-10-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("calendar reads", () => {
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

  const approved = async (marketCode: string) => {
    const made = await fx.makeVariant({ marketCode });
    await fx.makeRender(made.variantId);
    await approveVariant(fx.ctx, {
      variantId: made.variantId,
      lockVersion: (await fx.variant(made.variantId)).lockVersion,
      checklist: { factsChecked: true },
    });
    return made;
  };
  const schedule = (variantId: string, at: number) =>
    schedulePublication(fx.ctx, { variantId, scheduledAt: iso(at) });
  const week = { from: iso(NOW), to: iso(NOW + 7 * DAY) };

  it("lists the posts of a range, earliest first, with market, title and thumbnail", async () => {
    const es = await approved("es-ES");
    const en = await approved("en");
    const outside = await approved("es-ES");
    await schedule(es.variantId, NOW + 3 * DAY);
    await schedule(en.variantId, NOW + 1 * DAY);
    await schedule(outside.variantId, NOW + 10 * DAY);

    const items = await getCalendar(fx.ctx, week);
    expect(items.map((i) => i.market.code)).toEqual(["en", "es-ES"]);
    expect(items[0]).toMatchObject({
      variantId: en.variantId,
      title: "Hola",
      status: "SCHEDULED",
      market: { code: "en", name: "English", flagEmoji: "🌐", timeZone: "America/New_York" },
    });
    expect(items[0]?.at.toISOString()).toBe(iso(NOW + DAY));
    expect(items[0]?.thumbnailUrl).toMatch(/^memory:|https?:/);
    // The range is half open: the end is not in it.
    const exact = await getCalendar(fx.ctx, { from: iso(NOW + 3 * DAY), to: iso(NOW + 3 * DAY) });
    expect(exact).toEqual([]);
    const single = await getCalendar(fx.ctx, {
      from: iso(NOW + 3 * DAY),
      to: iso(NOW + 3 * DAY + 1),
    });
    expect(single.map((i) => i.variantId)).toEqual([es.variantId]);
  });

  it("filters by market and leaves out cancelled posts and dry runs", async () => {
    const es = await approved("es-ES");
    const en = await approved("en");
    const a = await schedule(es.variantId, NOW + DAY);
    await schedule(en.variantId, NOW + 2 * DAY);
    const dry = await approved("es-ES");
    const version = (await fx.variant(dry.variantId)).approvedVersionId as string;
    await fx.makePublication(dry.variantId, version, {
      dryRun: true,
      status: "DRY_RUN_PASSED",
      scheduledAt: new Date(NOW + 2 * DAY),
    });
    expect(
      (await getCalendar(fx.ctx, { ...week, marketIds: [es.marketId] })).map((i) => i.variantId),
    ).toEqual([es.variantId]);
    expect(await getCalendar(fx.ctx, week)).toHaveLength(2);
    await cancelPublication(fx.ctx, { publicationId: a.publication.id, reason: "x" });
    expect((await getCalendar(fx.ctx, week)).map((i) => i.variantId)).toEqual([en.variantId]);
  });

  it("warns about a missing account, switched-off publishing, a close neighbour and a late post", async () => {
    const a = await approved("es-ES");
    const b = await approved("es-ES");
    const c = await approved("es-ES");
    await schedule(a.variantId, NOW + 2 * DAY);
    await schedule(b.variantId, NOW + 2 * DAY + 60 * 60_000);
    await schedule(c.variantId, NOW + 4 * DAY);
    const first = await getCalendar(fx.ctx, week);
    const by = (id: string) => first.find((i) => i.variantId === id)?.warnings;
    expect(by(a.variantId)).toEqual(["NO_ACTIVE_ACCOUNT", "PUBLISHING_DISABLED", "MIN_GAP"]);
    expect(by(b.variantId)).toEqual(["NO_ACTIVE_ACCOUNT", "PUBLISHING_DISABLED", "MIN_GAP"]);
    expect(by(c.variantId)).toEqual(["NO_ACTIVE_ACCOUNT", "PUBLISHING_DISABLED"]);

    await t.db
      .update(schema.appSettings)
      .set({ value: true })
      .where(eq(schema.appSettings.key, "publishing.enabled"));
    await t.db.insert(schema.socialAccounts).values({
      marketId: a.marketId,
      username: "kitchen_es",
      instagramAccountId: "ig-1",
      accessTokenEncrypted: "enc:v1:x",
    });
    const second = await getCalendar(fx.ctx, week);
    expect(second.find((i) => i.variantId === c.variantId)?.warnings).toEqual([]);

    // Time passes: a post that still waits is late.
    fx.clock.set(new Date(NOW + 3 * DAY));
    const late = await getCalendar(fx.ctx, week);
    expect(late.find((i) => i.variantId === a.variantId)?.warnings).toEqual(["OVERDUE", "MIN_GAP"]);
    expect(late.find((i) => i.variantId === c.variantId)?.warnings).toEqual([]);
  });

  it("lists approved drafts without a post, longest waiting first, and drops them once scheduled", async () => {
    const first = await approved("es-ES");
    const second = await approved("en");
    await t.db
      .update(schema.contentVariantVersions)
      .set({ approvedAt: new Date(NOW - DAY) })
      .where(eq(schema.contentVariantVersions.contentVariantId, second.variantId));
    const waiting = await listApprovedNotScheduled(fx.ctx);
    expect(waiting.map((d) => d.variantId)).toEqual([second.variantId, first.variantId]);
    expect(waiting[0]).toMatchObject({
      title: "Hola",
      ideaTopic: "Rice",
      market: { code: "en", timeZone: "America/New_York" },
    });
    await schedule(second.variantId, NOW + DAY);
    expect((await listApprovedNotScheduled(fx.ctx)).map((d) => d.variantId)).toEqual([
      first.variantId,
    ]);
    // A cancelled post puts the draft back.
    const posts = await getCalendar(fx.ctx, week);
    await cancelPublication(fx.ctx, {
      publicationId: posts[0]?.publicationId as string,
      reason: "x",
    });
    expect(await listApprovedNotScheduled(fx.ctx)).toHaveLength(2);
  });
});
