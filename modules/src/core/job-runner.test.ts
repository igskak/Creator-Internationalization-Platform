import { schema } from "@rc/db";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { PermanentError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { jobHandlers } from "../job-handlers";
import {
  createInlineJobRunner,
  createServiceContext,
  createTriggerDevJobRunner,
  defineJob,
  disabledJobRunner,
  type JobDefinition,
  type JobEnvelope,
  type JobMeta,
  triggerJob,
} from "./index";

const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

describe("InlineJobRunner", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
  });

  afterEach(async () => {
    await t.close();
  });

  function makeRunner(handlers: Record<string, JobDefinition> = jobHandlers) {
    let counter = 0;
    return createInlineJobRunner({
      handlers,
      newRunId: () => `run_${++counter}`,
      makeContext: (runId: string, meta: JobMeta) =>
        createServiceContext({
          db: t.db,
          logger,
          actor: { type: "JOB", jobRunId: runId },
          ...(meta.requestId ? { requestId: meta.requestId } : {}),
        }),
    });
  }

  it("runs the hello job and writes its audit row (M0-14 done-when)", async () => {
    const runner = makeRunner();
    const webCtx = createServiceContext({
      db: t.db,
      logger,
      actor: { type: "SYSTEM" },
      requestId: "req-7",
      jobs: runner,
    });

    const { runId } = await triggerJob(webCtx, "hello", { name: "Reg.Chef" });

    const rows = await t.db.select().from(schema.auditEvents);
    expect(rows).toEqual([
      expect.objectContaining({
        action: "job.hello",
        actorType: "JOB",
        jobRunId: runId,
        requestId: "req-7",
        data: { name: "Reg.Chef" },
      }),
    ]);
    expect(runner.getRun(runId)).toMatchObject({
      status: "succeeded",
      result: { auditEventId: rows[0]?.id },
    });
  });

  it("applies payload defaults and rejects invalid payloads", async () => {
    const runner = makeRunner();
    await runner.trigger("hello", {});
    const [row] = await t.db.select().from(schema.auditEvents);
    expect(row?.data).toEqual({ name: "world" });
    await expect(runner.trigger("hello", { name: "" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns the same run for a repeated idempotency key", async () => {
    const runner = makeRunner();
    const first = await runner.trigger("hello", { name: "a" }, { idempotencyKey: "k1" });
    const second = await runner.trigger("hello", { name: "a" }, { idempotencyKey: "k1" });
    expect(second.runId).toBe(first.runId);
    expect(await t.db.select().from(schema.auditEvents)).toHaveLength(1);
  });

  it("clears the key of a failed run, like Trigger.dev", async () => {
    let attempts = 0;
    const flaky = defineJob({
      payload: z.object({}),
      run: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("first attempt fails");
        return "ok";
      },
    });
    const runner = makeRunner({ flaky });
    const trigger = runner.trigger as (
      name: string,
      payload: unknown,
      options?: { idempotencyKey?: string },
    ) => Promise<{ runId: string }>;
    await expect(trigger("flaky", {}, { idempotencyKey: "k" })).rejects.toThrow("first attempt");
    const retry = await trigger("flaky", {}, { idempotencyKey: "k" });
    expect(runner.getRun(retry.runId)?.status).toBe("succeeded");
    expect(attempts).toBe(2);
  });

  it("does not wait in background mode", async () => {
    let finished = false;
    const slow = defineJob({
      payload: z.object({}),
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        finished = true;
      },
    });
    const runner = createInlineJobRunner({
      handlers: { slow },
      mode: "background",
      makeContext: (runId) =>
        createServiceContext({ db: t.db, logger, actor: { type: "JOB", jobRunId: runId } }),
    });
    const trigger = runner.trigger as (
      name: string,
      payload: unknown,
    ) => Promise<{ runId: string }>;
    const { runId } = await trigger("slow", {});
    expect(finished).toBe(false);
    expect(runner.getRun(runId)?.status).toBe("running");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(finished).toBe(true);
  });
});

describe("TriggerDevJobRunner", () => {
  it("sends the envelope with request id and global-scope idempotency keys", async () => {
    const calls: { name: string; envelope: JobEnvelope; options: Record<string, unknown> }[] = [];
    const scopedKeys: string[] = [];
    const runner = createTriggerDevJobRunner(
      { secretKey: "tr_dev_synthetic" },
      {
        trigger: async (name, envelope, options) => {
          calls.push({ name, envelope, options });
          return { id: "run_abc" };
        },
        createIdempotencyKey: async (key) => {
          scopedKeys.push(key);
          return `global:${key}`;
        },
      },
    );

    const result = await runner.trigger(
      "hello",
      { name: "x" },
      {
        idempotencyKey: "source-1",
        delaySeconds: 90.5,
        concurrencyKey: "acc-1",
        tags: ["m0"],
        requestId: "req-1",
      },
    );

    expect(result).toEqual({ runId: "run_abc" });
    expect(scopedKeys).toEqual(["hello:source-1"]);
    expect(calls).toEqual([
      {
        name: "hello",
        envelope: { payload: { name: "x" }, meta: { requestId: "req-1" } },
        options: {
          idempotencyKey: "global:hello:source-1",
          delay: "91s",
          concurrencyKey: "acc-1",
          tags: ["m0"],
        },
      },
    ]);
  });
});

describe("disabledJobRunner", () => {
  it("is the default and refuses to start jobs", async () => {
    const t = await createTestDb();
    const ctx = createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" } });
    expect(ctx.jobs).toBe(disabledJobRunner);
    await expect(triggerJob(ctx, "hello", { name: "x" })).rejects.toBeInstanceOf(PermanentError);
    await t.close();
  });
});

describe("hello job fail flag", () => {
  it("throws a PermanentError without writing an audit row", async () => {
    const t = await createTestDb();
    const runner = createInlineJobRunner({
      handlers: jobHandlers,
      makeContext: (runId) =>
        createServiceContext({ db: t.db, logger, actor: { type: "JOB", jobRunId: runId } }),
    });
    await expect(runner.trigger("hello", { fail: true })).rejects.toBeInstanceOf(PermanentError);
    expect(await t.db.select().from(schema.auditEvents)).toHaveLength(0);
    await t.close();
  });
});
