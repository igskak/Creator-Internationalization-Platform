import { defineConfig } from "vitest/config";

// Vitest 5 has no vitest.workspace.ts; every workspace package is a test project.
export default defineConfig({
  test: {
    projects: ["apps/*", "modules", "lib", "db", "jobs", "prompts", "templates", "evals"],
  },
});
