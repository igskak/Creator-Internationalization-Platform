import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev v4 (plan 01 D-05, 06 §6.1; V-17 checked 2026-09-27).
// The project ref is not secret; it comes from TRIGGER_PROJECT_REF so each developer can point
// `pnpm jobs:dev` at their own project.
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
    extensions: [],
  },
});
