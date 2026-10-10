import { fileURLToPath } from "node:url";
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

// The web app's component tests (`*.test.tsx`) pick jsdom with a `// @vitest-environment jsdom`
// line. JSX is compiled with the automatic runtime because apps/web/tsconfig.json says
// `jsx: preserve` for Next.js, and `@/` is the web app's src.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) },
  },
  test: {
    hookTimeout: 60_000,
    testTimeout: 30_000,
    projects: Object.entries(packages).map(([name, root]) => ({
      extends: true,
      test: { name, root },
    })),
  },
});
