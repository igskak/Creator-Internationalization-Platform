import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev v4 (plan 01 D-05, 06 §6.1; V-17 checked 2026-09-27).
// The project ref is not secret; it comes from TRIGGER_PROJECT_REF so each developer can point
// `pnpm jobs:dev` at their own project. `trigger dev --env-file` loads .env for the worker only,
// not for this file, so read the root .env here (cwd is jobs/; absent in CI, where env is set).
if (!process.env.TRIGGER_PROJECT_REF) {
  try {
    process.loadEnvFile("../.env");
  } catch {
    // No .env: the placeholder below makes the CLI say which variable is missing.
  }
}

const sentryJobsProject = process.env.SENTRY_PROJECT_JOBS ?? process.env.SENTRY_PROJECT;

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_set_TRIGGER_PROJECT_REF",
  dirs: ["./src/tasks"],
  runtime: "node-24",
  machine: "small-1x",
  maxDuration: 900,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 5_000,
      maxTimeoutInMs: 300_000,
      randomize: true,
    },
  },
  build: {
    // Playwright/Chromium for render-carousel is added in M3-12.
    // Source maps go to Sentry on `trigger deploy` when SENTRY_AUTH_TOKEN is set (M0-19).
    extensions: process.env.SENTRY_AUTH_TOKEN
      ? [
          esbuildPlugin(
            sentryEsbuildPlugin({
              ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
              ...(sentryJobsProject ? { project: sentryJobsProject } : {}),
              authToken: process.env.SENTRY_AUTH_TOKEN,
              telemetry: false,
            }),
            { placement: "last", target: "deploy" },
          ),
        ]
      : [],
  },
});
