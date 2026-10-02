import { schema } from "@rc/db";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliCommands } from "./cli-commands";
import { cliHelp, createServiceContext, runCliCommand, type ServiceContext } from "./core";

describe("dev CLI", () => {
  let t: TestDb;
  let ctx: ServiceContext;

  beforeEach(async () => {
    t = await createTestDb();
    ctx = createServiceContext({
      db: t.db,
      logger: createLogger({
        service: "cli",
        env: "test",
        level: "error",
        destination: { write: () => {} },
      }),
      actor: { type: "SYSTEM" },
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await t.close();
  });

  it("hello writes an audit event", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCliCommand(cliCommands, ctx, ["hello", "dev"]);
    const rows = await t.db.select().from(schema.auditEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "job.hello",
      actorType: "SYSTEM",
      data: { name: "dev" },
    });
  });

  it("rejects unknown and missing commands with the help text", async () => {
    await expect(runCliCommand(cliCommands, ctx, ["nope"])).rejects.toThrow(
      /Unknown command "nope"[\s\S]*hello/,
    );
    await expect(runCliCommand(cliCommands, ctx, [])).rejects.toThrow(/No command given/);
    expect(cliHelp(cliCommands)).toContain("hello [name]");
  });
});
