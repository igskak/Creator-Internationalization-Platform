import { defineConfig } from "vitest/config";

// Vitest 5 has no vitest.workspace.ts; every workspace package is a test project and inherits
// these options (`extends: true`). PGlite tests boot WASM Postgres + pgvector + all migrations per
// file; with files running in parallel that can take well over the 10 s default.
const packages = {
  "@rc/web": "apps/web",
  "@rc/modules": "modules",
  "@rc/lib": "lib",
  "@rc/db": "db",
  "@rc/jobs": "jobs",
  "@rc/cli": "cli",
  "@rc/prompts": "prompts",
  "@rc/templates": "templates",
  "@rc/evals": "evals",
};

export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 30_000,
    projects: Object.entries(packages).map(([name, root]) => ({
      extends: true,
      test: { name, root },
    })),
  },
});
