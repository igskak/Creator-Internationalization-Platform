import { schema } from "@rc/db";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { budgetState, checkAiBudget, getAiCostOverview } from "./ai/budget";
import { type ReviewFixture, reviewFixture } from "./content/variants/test-support";
import { setAppSetting } from "./settings";

// H-05 on fixture costs (a cross-module test: ai with settings and the review fixture): the month to date by stage (UTC month), the amber and red states, and
// one alert per month and level. The fixture clock is 2026-10-10 12:00 UTC.

describe("AI cost and budget", () => {
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

  const run = (
    stage: (typeof schema.generationRuns.$inferInsert)["stage"],
    costUsd: string | null,
    at: string,
    status: (typeof schema.generationRuns.$inferInsert)["status"] = "SUCCEEDED",
  ) =>
    t.db.insert(schema.generationRuns).values({
      stage,
      promptId: "p",
      promptVersion: 1,
      promptHash: "h",
      provider: "fake",
      model: "fake",
      params: {},
      inputHash: `i-${Math.random()}`,
      status,
      costUsd,
      createdAt: new Date(at),
    });

  it("adds up the month by stage and leaves out last month", async () => {
    await run("CONTENT_WRITING", "1.2500", "2026-10-02T10:00:00Z");
    await run("CONTENT_WRITING", "0.7500", "2026-10-09T10:00:00Z");
    await run("CRITIC", "0.5000", "2026-10-10T11:00:00Z", "INVALID_OUTPUT");
    await run("REEL_SHOT", "2.0000", "2026-10-05T10:00:00Z");
    await run("CONTENT_WRITING", "9.0000", "2026-09-30T23:59:00Z"); // September
    await run("CRITIC", null, "2026-10-03T10:00:00Z"); // no cost recorded
    const o = await getAiCostOverview(fx.ctx);
    expect(o.month).toBe("2026-10");
    expect(o.monthToDateUsd).toBe(4.5);
    expect(o.byStage).toEqual([
      { stage: "CONTENT_WRITING", runs: 2, failed: 0, costUsd: 2 },
      { stage: "REEL_SHOT", runs: 1, failed: 0, costUsd: 2 },
      { stage: "CRITIC", runs: 2, failed: 1, costUsd: 0.5 },
    ]);
    expect(o).toMatchObject({ budgetUsd: null, share: null, state: "NONE" });
    expect(o.last24h).toMatchObject({ runs: 1, invalid: 1 }); // 2026-10-09 10:00 is 26 h back
    expect(o.stages.find((s) => s.stage === "CONTENT_WRITING")).toMatchObject({
      promptId: "content-writer",
      model: "claude-opus-5-5",
    });
  });

  it("is amber from 80 % and red above 100 %", () => {
    expect(budgetState(79.99, 100)).toBe("GREEN");
    expect(budgetState(80, 100)).toBe("AMBER");
    expect(budgetState(100, 100)).toBe("AMBER");
    expect(budgetState(100.01, 100)).toBe("RED");
    expect(budgetState(500, null)).toBe("NONE");
    expect(budgetState(500, 0)).toBe("NONE");
  });

  it("alerts once per level and month", async () => {
    await setAppSetting(fx.ctx, { key: "ai.monthly_budget_usd", value: 10 });
    await run("CONTENT_WRITING", "5.0000", "2026-10-02T10:00:00Z");
    expect((await checkAiBudget(fx.ctx)).alert).toBeNull(); // 50 %: green

    await run("CONTENT_WRITING", "3.5000", "2026-10-03T10:00:00Z");
    const amber = await checkAiBudget(fx.ctx);
    expect(amber).toMatchObject({
      state: "AMBER",
      alert: { level: "AMBER", month: "2026-10", monthToDateUsd: 8.5, budgetUsd: 10 },
    });
    expect((await checkAiBudget(fx.ctx)).alert).toBeNull(); // already alerted

    await run("CONTENT_WRITING", "2.0000", "2026-10-04T10:00:00Z");
    expect((await checkAiBudget(fx.ctx)).alert).toMatchObject({
      level: "RED",
      monthToDateUsd: 10.5,
    });
    expect((await checkAiBudget(fx.ctx)).alert).toBeNull();

    // A new month starts quiet and alerts again when it gets there.
    fx.clock.set("2026-11-20T12:00:00Z");
    await run("CONTENT_WRITING", "8.0000", "2026-11-10T10:00:00Z");
    expect((await checkAiBudget(fx.ctx)).alert).toMatchObject({ level: "AMBER", month: "2026-11" });
    const audits = (await t.db.select().from(schema.auditEvents)).filter(
      (a) => a.action === "ai.budget_alert",
    );
    expect(audits).toHaveLength(3);
  });
});
