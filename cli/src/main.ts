import { createDb, isPoolerUrl } from "@rc/db";
import { EnvValidationError, loadServerEnv } from "@rc/lib/env";
import { createLogger } from "@rc/lib/logging";
import { createLlmProvider } from "@rc/lib/providers/llm";
import { createStorage } from "@rc/lib/providers/storage";
import { cliCommands } from "@rc/modules/cli-commands";
import {
  cliHelp,
  createInlineJobRunner,
  createServiceContext,
  runCliCommand,
} from "@rc/modules/core";
import { jobHandlers } from "@rc/modules/job-handlers";

// `pnpm rc <command>`: runs a module-registered command against the database in .env.
// Actor is SYSTEM; the CLI is a development tool and refuses production.
const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
  console.log(cliHelp(cliCommands));
  process.exit(0);
}

const env = (() => {
  try {
    return loadServerEnv();
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    console.error(`rc: ${error.message}`);
    process.exit(1);
  }
})();
if (env.appEnv === "production") {
  console.error("rc: refusing to run against APP_ENV=production.");
  process.exit(1);
}

const url = env.db.directUrl ?? env.db.url;
const { db, close } = createDb(url, { pooled: isPoolerUrl(url), max: 1 });
const logger = createLogger({
  service: "cli",
  env: env.appEnv,
  level: env.observability.logLevel,
});
const providers = {
  db,
  logger,
  storage: createStorage(env.storage),
  llm: createLlmProvider(env.ai),
};
// Jobs run in-process, one after the other, so a command can wait for ingestion to finish.
const jobs: ReturnType<typeof createInlineJobRunner> = createInlineJobRunner({
  handlers: jobHandlers,
  mode: "await",
  makeContext: (runId) =>
    createServiceContext({ ...providers, actor: { type: "JOB", jobRunId: runId }, jobs }),
});
const ctx = createServiceContext({ ...providers, actor: { type: "SYSTEM" }, jobs });

try {
  await runCliCommand(cliCommands, ctx, argv);
} catch (error) {
  console.error(`rc: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await close();
}
