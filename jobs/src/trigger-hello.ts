import { EnvValidationError, loadServerEnv } from "@rc/lib/env";
import { createTriggerDevJobRunner } from "@rc/modules/core";
import "@rc/modules/job-handlers";

// `pnpm jobs:hello`: triggers the hello task through Trigger.dev (needs `pnpm jobs:dev` running).
const env = (() => {
  try {
    return loadServerEnv();
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    console.error(`jobs:hello: ${error.message}`);
    process.exit(1);
  }
})();
if (env.jobs.mode !== "trigger") {
  console.error("jobs:hello: set JOBS_MODE=trigger and TRIGGER_SECRET_KEY (dev key) in .env.");
  process.exit(1);
}

const runner = createTriggerDevJobRunner({ secretKey: env.jobs.triggerSecretKey });
const { runId } = await runner.trigger("hello", { name: process.argv[2] ?? "world" });
console.log(
  `jobs:hello: triggered run ${runId}; check the audit_events table and the Trigger.dev dashboard.`,
);
