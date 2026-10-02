import type { CliCommands } from "./core/cli";
import { runJobHandler } from "./core/job-runner";
import { helloJob } from "./job-handlers";

// Dev CLI commands (`pnpm rc <name>`, plan 15 M0-21). Later tasks add `ingest`, `generate`, `eval`.
// Like jobs and server actions, commands stay thin: validate → call one service.
export const cliCommands: CliCommands = {
  hello: {
    description: "Run the hello job in-process; writes one audit event",
    usage: "hello [name]",
    run: async (ctx, args) => {
      const result = (await runJobHandler(helloJob, ctx, { name: args[0] ?? "world" })) as {
        auditEventId: number;
      };
      console.log(`rc hello: wrote audit event ${result.auditEventId}`);
    },
  },
};
