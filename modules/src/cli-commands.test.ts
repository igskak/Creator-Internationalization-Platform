import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@rc/db";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import { FIXTURE_OUTPUT, FIXTURE_PAGES } from "@rc/prompts/fixtures/knowledge-extractor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliCommands } from "./cli-commands";
import {
  cliHelp,
  createInlineJobRunner,
  createServiceContext,
  runCliCommand,
  type ServiceContext,
} from "./core";
import { jobHandlers } from "./job-handlers";

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

  describe("ingest", () => {
    let dir: string;
    let ingestCtx: ServiceContext;
    const logs = () =>
      vi
        .mocked(console.log)
        .mock.calls.map((c) => c.join(" "))
        .join("\n");

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "rc-cli-test-"));
      await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
      const base = {
        db: t.db,
        logger: createLogger({
          service: "cli",
          env: "test",
          level: "fatal",
          destination: { write: () => {} },
        }),
        storage: createMemoryStorage(),
        llm: createFakeLLMProvider({ handler: () => FIXTURE_OUTPUT }),
      };
      const jobs: ReturnType<typeof createInlineJobRunner> = createInlineJobRunner({
        handlers: jobHandlers,
        mode: "await",
        makeContext: (runId) =>
          createServiceContext({ ...base, actor: { type: "JOB", jobRunId: runId }, jobs }),
      });
      ingestCtx = createServiceContext({ ...base, actor: { type: "SYSTEM" }, jobs });
      vi.spyOn(console, "log").mockImplementation(() => {});
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("uploads a file, runs ingestion and prints a summary", async () => {
      const file = join(dir, "guide.md");
      await writeFile(
        file,
        FIXTURE_PAGES.map((p, i) => `# Раздел ${i + 1}\n\n${p.text}`).join("\n\n"),
      );
      await runCliCommand(cliCommands, ingestCtx, [
        "ingest",
        file,
        "--type",
        "guide",
        "--language",
        "ru",
        "--ai-allowed",
      ]);
      const output = logs();
      expect(output).toContain("status:  READY");
      expect(output).toContain("pages:   4");
      expect(output).toContain("cards:   2");
      expect(output).toMatch(/model: {3}1 calls, \d+ in \/ \d+ out tokens, \$\d+\.\d{4}/);
      const [source] = await t.db.select().from(schema.sourceAssets);
      expect(source).toMatchObject({
        title: "guide.md",
        type: "GUIDE",
        processingStatus: "READY",
        rights: expect.objectContaining({ aiProcessing: "ALLOWED" }),
      });
    });

    it("asks for explicit confirmation and rejects bad arguments before touching anything", async () => {
      const file = join(dir, "guide.md");
      await writeFile(file, "# A\n\ntext");
      await expect(runCliCommand(cliCommands, ingestCtx, ["ingest", file])).rejects.toThrow(
        /--ai-allowed/,
      );
      await expect(
        runCliCommand(cliCommands, ingestCtx, ["ingest", "--ai-allowed"]),
      ).rejects.toThrow(/Give a file/);
      await expect(
        runCliCommand(cliCommands, ingestCtx, ["ingest", file, "--ai-allowed", "--type", "VIDEO2"]),
      ).rejects.toThrow(/Unknown source type/);
      await expect(
        runCliCommand(cliCommands, ingestCtx, ["ingest", join(dir, "a.exe"), "--ai-allowed"]),
      ).rejects.toThrow(/Unsupported file extension/);
      expect(await t.db.select().from(schema.sourceAssets)).toHaveLength(0);
    });
  });
});
