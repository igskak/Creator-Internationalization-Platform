import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createPostgresTestDb, type PostgresTestDb } from "@rc/db/test-db-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveVariant } from "../content";
import { type ReviewFixture, recordingJobs, reviewFixture } from "../content/variants/test-support";
import type { ServiceContext } from "../core";
import { connectTestAccount, mockRuntime, newMock } from "../instagram/test-support";
import { dispatchDuePublications } from "./dispatcher";
import { runPublication } from "./publish-machine";
import { schedulePublication } from "./schedule";

// Concurrency on a REAL Postgres (plan 13 §13.3, M5-07): PGlite has one connection, so locks,
// SKIP LOCKED and unique indexes under a race can only be checked here. Runs when TEST_POSTGRES_URL
// points at a server with pgvector (the CI service container; locally e.g. a docker container),
// and is skipped otherwise.

const env = process.env;
const POSTGRES_URL = env.TEST_POSTGRES_URL;
const ES = "1784";

describe.skipIf(!POSTGRES_URL)("concurrency on a real Postgres", () => {
  let pg: PostgresTestDb;
  let fx: ReviewFixture;
  let mock: ReturnType<typeof newMock>;
  let recorder: ReturnType<typeof recordingJobs>;
  const closers: (() => Promise<void>)[] = [];

  /** A context with its own connection pool, as a separate worker would have. */
  const worker = (runId: string): ServiceContext => {
    const { db, close } = pg.connect();
    closers.push(close);
    return {
      ...fx.ctx,
      db,
      actor: { type: "JOB", jobRunId: runId },
      sleep: async (ms) => {
        fx.clock.advance(ms);
      },
    };
  };

  beforeAll(async () => {
    pg = await createPostgresTestDb(POSTGRES_URL as string);
    const { db, close } = pg.connect();
    closers.push(close);
    await seedDatabase(db, { ownerEmails: ["owner@example.com"] });
    mock = newMock({ now: () => fx.clock.now() });
    recorder = recordingJobs();
    fx = await reviewFixture(db, {
      jobs: recorder.runner,
      instagram: mockRuntime(mock, { allowlist: [ES] }),
    });
    await db
      .insert(schema.appSettings)
      .values({ key: "publishing.enabled", value: true })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: true } });
  }, 120_000);

  afterAll(async () => {
    await Promise.all(closers.map((c) => c().catch(() => {})));
    await pg?.drop();
  }, 60_000);

  it("parallel dispatchers claim every due publication exactly once", async () => {
    const { marketId } = await fx.makeVariant({ status: "SCHEDULED" });
    await connectTestAccount(fx.ctx, mock, { marketId, accountId: ES });
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const made = await fx.makeVariant({ status: "SCHEDULED" });
      const { versionId } = await fx.makeVersion(made.variantId);
      ids.push(
        await fx.makePublication(made.variantId, versionId, {
          scheduledAt: new Date(fx.clock.now().getTime() - (i + 1) * 60_000),
        }),
      );
    }
    const dispatchers = Array.from({ length: 6 }, (_, i) => worker(`dispatcher-${i}`));
    const drain = async (ctx: ServiceContext) => {
      const mine: string[] = [];
      for (;;) {
        const { dispatched } = await dispatchDuePublications(ctx, { limit: 4 });
        if (dispatched.length === 0) return mine;
        mine.push(...dispatched);
      }
    };
    const taken = (await Promise.all(dispatchers.map(drain))).flat();
    expect(taken).toHaveLength(30);
    expect(new Set(taken).size).toBe(30);
    expect(taken.toSorted()).toEqual(ids.toSorted());
    const started = recorder.calls.filter((c) => c.name === "publish-content");
    expect(started).toHaveLength(30);
    expect(new Set(started.map((c) => c.options?.idempotencyKey)).size).toBe(30);
  }, 120_000);

  it("the unique index lets exactly one of many parallel schedules through", async () => {
    const made = await fx.makeVariant();
    await fx.makeRender(made.variantId);
    await approveVariant(fx.ctx, {
      variantId: made.variantId,
      lockVersion: (await fx.variant(made.variantId)).lockVersion,
      checklist: { factsChecked: true },
    });
    const at = new Date(fx.clock.now().getTime() + 3_600_000).toISOString();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        schedulePublication(worker(`scheduler-${i}`), {
          variantId: made.variantId,
          scheduledAt: at,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await fx.ctx.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.contentVariantId, made.variantId));
    expect(rows).toHaveLength(1);
  }, 120_000);

  it("parallel workers on one publication post once", async () => {
    mock.addAccount({ id: ES, username: "kitchen_es" });
    const made = await fx.makeVariant({ status: "SCHEDULED" });
    const { versionId } = await fx.makeVersion(made.variantId);
    const publicationId = await fx.makePublication(made.variantId, versionId, {
      status: "QUEUED",
      mode: "IMMEDIATE",
      scheduledAt: null,
    });
    const before = mock.publishedMedia().length;
    const outcomes = await Promise.all(
      ["w1", "w2", "w3", "w4"].map((id) => runPublication(worker(id), { publicationId })),
    );
    expect(outcomes.filter((o) => o.status === "PUBLISHED")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "IN_FLIGHT")).toHaveLength(3);
    expect(mock.publishedMedia().length - before).toBe(1);
    const [row] = await fx.ctx.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.id, publicationId));
    expect(row).toMatchObject({ status: "PUBLISHED" });
  }, 120_000);
});
