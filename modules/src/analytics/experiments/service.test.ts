import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ForbiddenError, InvalidStateError, ValidationError } from "@rc/lib/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ReviewFixture, reviewFixture } from "../../content/variants/test-support";
import {
  assignExperimentArm,
  getArmChoices,
  getExperimentResults,
  listExperiments,
  setExperimentStatus,
  upsertExperiment,
} from "./index";

// M7-06 on fixture data: create, start, assign arms, "insufficient data" until both arms have the
// minimum, the result math, completion confirming the market's visual hypothesis.

describe("experiments", () => {
  let t: TestDb;
  let fx: ReviewFixture;
  let es: string;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    fx = await reviewFixture(t.db);
    es = fx.marketId;
    await t.db
      .update(schema.markets)
      .set({
        visualHypotheses: [
          {
            id: "bright",
            description: "Bright daylight photos",
            visualStyle: "BRIGHT",
            status: "UNTESTED",
          },
        ],
      })
      .where(eq(schema.markets.id, es));
  });
  afterEach(async () => {
    await t.close();
  });

  const create = (over: Record<string, unknown> = {}) =>
    upsertExperiment(fx.ctx, {
      name: "Warm or bright",
      hypothesis: "Bright photos get more saves in Spain.",
      marketId: es,
      dimension: "visual_style",
      variantA: "WARM",
      variantB: "BRIGHT",
      minPostsPerArm: 3,
      visualHypothesisId: "bright",
      ...over,
    });

  /** A published post in an arm with a D7 save rate of `saves` per 1,000. */
  async function armPost(experimentId: string, arm: "A" | "B", saves: number) {
    const { variantId } = await fx.makeVariant({ status: "PUBLISHED" });
    await assignExperimentArm(fx.ctx, { variantId, experimentId, arm });
    const { versionId } = await fx.makeVersion(variantId);
    const publicationId = await fx.makePublication(variantId, versionId, {
      status: "PUBLISHED",
      mode: "IMMEDIATE",
      publishedAt: new Date("2026-09-20T09:00:00Z"),
    });
    await t.db.insert(schema.metricSnapshots).values({
      publicationId,
      snapshotSlot: "D7",
      measuredAt: new Date("2026-09-27T09:00:00Z"),
      mediaAgeHours: "168",
      reach: 1000,
      saves,
      rawMetricsJson: {},
      apiVersion: "v25.0",
    });
  }

  it("validates the arms, the dimension and the hypothesis", async () => {
    await expect(create({ variantB: "WARM" })).rejects.toBeInstanceOf(ValidationError);
    await expect(create({ dimension: "colour" })).rejects.toBeInstanceOf(ValidationError);
    await expect(create({ visualHypothesisId: "nope" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create({ dimension: "hook_type", variantA: "QUESTION", variantB: "LIST" }),
    ).rejects.toBeInstanceOf(ValidationError); // a hook experiment cannot test a visual hypothesis
    await expect(upsertExperiment(fx.as("chef"), { name: "x" } as never)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("says insufficient data until both arms have the minimum, then compares them", async () => {
    const x = await create();
    await setExperimentStatus(fx.ctx, { id: x.id, status: "RUNNING" });
    for (const s of [20, 25, 30]) await armPost(x.id, "A", s);
    for (const s of [40, 50]) await armPost(x.id, "B", s);
    // A draft assigned to arm B without numbers yet.
    const { variantId } = await fx.makeVariant({});
    await assignExperimentArm(fx.ctx, { variantId, experimentId: x.id, arm: "B" });

    let [r] = await getExperimentResults(fx.ctx, [x.id]);
    expect(r).toMatchObject({
      sufficient: false,
      difference: null,
      pValue: null,
      a: { assigned: 3, n: 3, median: 0.025 },
      b: { assigned: 3, n: 2, median: 0.045 },
    });

    await armPost(x.id, "B", 60);
    [r] = await getExperimentResults(fx.ctx, [x.id]);
    expect(r?.sufficient).toBe(true);
    expect(r?.b.median).toBeCloseTo(0.05, 10);
    expect(r?.difference).toBeCloseTo(0.025, 10);
    // Complete separation of 3 and 3, exact: p = 2 / C(6,3) = 0.1.
    expect(r?.method).toBe("exact");
    expect(r?.pValue).toBeCloseTo(0.1, 10);
    const [listed] = await listExperiments(fx.ctx);
    expect(listed).toMatchObject({ id: x.id, marketCode: "es-ES", status: "RUNNING" });
  });

  it("moves the visual hypothesis with the experiment: testing, then confirmed", async () => {
    const hypothesis = async () =>
      (await t.db.select().from(schema.markets).where(eq(schema.markets.id, es)))[0]
        ?.visualHypotheses[0]?.status;
    const x = await create();
    await setExperimentStatus(fx.ctx, { id: x.id, status: "RUNNING" });
    expect(await hypothesis()).toBe("TESTING");
    // Only a draft can be edited; a running one cannot go back.
    await expect(
      upsertExperiment(fx.ctx, { ...x, id: x.id, notes: "x" } as never),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await setExperimentStatus(fx.ctx, { id: x.id, status: "COMPLETED", outcome: "CONFIRMED" });
    expect(await hypothesis()).toBe("CONFIRMED");
    await expect(
      setExperimentStatus(fx.ctx, { id: x.id, status: "RUNNING" }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    const second = await create({ name: "Again" });
    await setExperimentStatus(fx.ctx, { id: second.id, status: "CANCELLED" });
    expect(await hypothesis()).toBe("UNTESTED");
  });

  it("keeps arms inside the market and the open experiments, and clears an arm", async () => {
    const x = await create();
    const other = await fx.makeVariant({ marketCode: "en" });
    await expect(
      assignExperimentArm(fx.ctx, { variantId: other.variantId, experimentId: x.id, arm: "A" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const mine = await fx.makeVariant({});
    await expect(
      assignExperimentArm(fx.ctx, { variantId: mine.variantId, experimentId: x.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await assignExperimentArm(fx.ctx, { variantId: mine.variantId, experimentId: x.id, arm: "A" });
    expect(
      await assignExperimentArm(fx.ctx, { variantId: mine.variantId, experimentId: null }),
    ).toEqual({
      experimentId: null,
      arm: null,
    });
    await setExperimentStatus(fx.ctx, { id: x.id, status: "CANCELLED" });
    await expect(
      assignExperimentArm(fx.ctx, { variantId: mine.variantId, experimentId: x.id, arm: "A" }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("tells the review screen each draft's arm and the open experiments of its market", async () => {
    const x = await create();
    const done = await create({ name: "Old" });
    await setExperimentStatus(fx.ctx, { id: done.id, status: "CANCELLED" });
    const es1 = await fx.makeVariant({});
    const en1 = await fx.makeVariant({ marketCode: "en" });
    await assignExperimentArm(fx.ctx, { variantId: es1.variantId, experimentId: x.id, arm: "B" });
    const choices = await getArmChoices(fx.ctx, [es1.variantId, en1.variantId]);
    expect(choices[es1.variantId]).toEqual({
      current: { experimentId: x.id, name: "Warm or bright", arm: "B" },
      open: [
        { id: x.id, name: "Warm or bright", variantA: "WARM", variantB: "BRIGHT", status: "DRAFT" },
      ],
    });
    expect(choices[en1.variantId]).toEqual({ current: null, open: [] });
  });
});
