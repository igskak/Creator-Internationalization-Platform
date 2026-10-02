import { installConsoleScrubber } from "@rc/lib/observability";
import { tasks } from "@trigger.dev/sdk";
import { initJobSentry, reportJobFailure } from "../sentry";

// Loaded by Trigger.dev before any task in this directory (v4 `init.ts`).
installConsoleScrubber();
initJobSentry();

// Final failures only (after retries), so Sentry is not flooded by transient errors.
tasks.onFailure(({ payload, error, ctx }) => {
  reportJobFailure(error, { taskId: ctx.task.id, runId: ctx.run.id, payload });
});
