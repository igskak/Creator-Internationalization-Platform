import { schema } from "@rc/db";
import { eq, sql } from "@rc/db/orm";
import { pgTable, text, uuid } from "@rc/db/pg-core";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { InvalidStateError, NotFoundError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  audit,
  createServiceContext,
  manualClock,
  type ServiceContext,
  transition,
  withTransaction,
} from "./index";

// A throwaway table with a status column, standing in for content_variants etc.
const items = pgTable("test_items", {
  id: uuid().primaryKey().defaultRandom(),
  status: text().$type<"DRAFT" | "READY" | "APPROVED" | "REJECTED">().notNull(),
  note: text(),
});

const lines: string[] = [];
const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "debug",
  destination: { write: (line: string) => void lines.push(line) },
});

describe("core", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let userId: string;
  const clock = manualClock("2026-09-27T12:00:00Z");

  beforeEach(async () => {
    t = await createTestDb();
    await t.db.execute(sql`create table test_items (
      id uuid primary key default gen_random_uuid(), status text not null, note text)`);
    const [user] = await t.db
      .insert(schema.appUsers)
      .values({ email: "editor@example.com" })
      .returning();
    userId = user?.id ?? "";
    ctx = createServiceContext({
      db: t.db,
      logger,
      clock,
      requestId: "req-42",
      actor: { type: "USER", userId, role: "editor" },
    });
  });

  afterEach(async () => {
    await t.close();
  });

  async function insertItem(status: "DRAFT" | "READY" | "APPROVED" | "REJECTED") {
    const [row] = await t.db.insert(items).values({ status }).returning();
    return row?.id ?? "";
  }

  async function auditRows() {
    return t.db.select().from(schema.auditEvents).orderBy(schema.auditEvents.id);
  }

  describe("audit", () => {
    it("writes actor, time, request id and redacted data", async () => {
      const id = await audit(ctx, {
        action: "settings.changed",
        entityType: "app_setting",
        data: { key: "publishing.enabled", value: true, accessToken: "IGQV-secret" },
      });
      const [row] = await auditRows();
      expect(row).toMatchObject({
        id,
        actorType: "USER",
        actorUserId: userId,
        requestId: "req-42",
        jobRunId: null,
        action: "settings.changed",
        entityType: "app_setting",
        occurredAt: new Date("2026-09-27T12:00:00Z"),
        data: { key: "publishing.enabled", value: true, accessToken: "[REDACTED]" },
      });
    });

    it("records job actors with their run id", async () => {
      const jobCtx = createServiceContext({
        db: t.db,
        logger,
        actor: { type: "JOB", jobRunId: "run_123" },
      });
      await audit(jobCtx, { action: "hello.ran", entityType: "job" });
      const [row] = await auditRows();
      expect(row).toMatchObject({ actorType: "JOB", actorUserId: null, jobRunId: "run_123" });
    });
  });

  describe("transition", () => {
    it("changes an allowed status, sets extra columns and audits from → to", async () => {
      const id = await insertItem("DRAFT");
      const row = await transition(ctx, {
        table: items,
        id,
        from: ["DRAFT", "REJECTED"],
        to: "READY",
        set: { note: "submitted" },
        audit: { action: "item.submitted", data: { reason: "done" } },
      });
      expect(row).toMatchObject({ id, status: "READY", note: "submitted" });
      const [event] = await auditRows();
      expect(event).toMatchObject({
        action: "item.submitted",
        entityType: "test_items",
        entityId: id,
        data: { reason: "done", from: "DRAFT", to: "READY" },
      });
    });

    it("refuses a status outside `from`, changes nothing and writes no audit row", async () => {
      const id = await insertItem("APPROVED");
      const error = await transition(ctx, {
        table: items,
        id,
        from: ["DRAFT"],
        to: "READY",
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidStateError);
      expect((error as InvalidStateError).details).toMatchObject({
        from: "APPROVED",
        allowedFrom: ["DRAFT"],
        to: "READY",
      });
      const [row] = await t.db.select().from(items).where(eq(items.id, id));
      expect(row?.status).toBe("APPROVED");
      expect(await auditRows()).toHaveLength(0);
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(
        transition(ctx, {
          table: items,
          id: "00000000-0000-0000-0000-000000000000",
          from: ["DRAFT"],
          to: "READY",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rolls back the status change when the surrounding transaction fails", async () => {
      const id = await insertItem("DRAFT");
      await expect(
        withTransaction(ctx, async (tx) => {
          await transition(tx, { table: items, id, from: ["DRAFT"], to: "READY" });
          throw new Error("later step failed");
        }),
      ).rejects.toThrow("later step failed");
      const [row] = await t.db.select().from(items).where(eq(items.id, id));
      expect(row?.status).toBe("DRAFT");
      expect(await auditRows()).toHaveLength(0);
    });

    it("allows a second transition from the new state only", async () => {
      const id = await insertItem("DRAFT");
      await transition(ctx, { table: items, id, from: ["DRAFT"], to: "READY" });
      await expect(
        transition(ctx, { table: items, id, from: ["DRAFT"], to: "READY" }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await transition(ctx, { table: items, id, from: ["READY"], to: "APPROVED" });
      expect((await auditRows()).map((r) => r.data)).toEqual([
        { from: "DRAFT", to: "READY" },
        { from: "READY", to: "APPROVED" },
      ]);
    });
  });

  describe("createServiceContext", () => {
    it("binds request id and actor to the logger", () => {
      lines.length = 0;
      ctx.logger.info("hello");
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        requestId: "req-42",
        actorType: "USER",
        userId,
      });
    });
  });
});
