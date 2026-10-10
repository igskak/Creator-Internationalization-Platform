import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// One run for the whole workspace (`pnpm test`). The web app's component tests (`*.test.tsx`) pick
// jsdom with a `// @vitest-environment jsdom` line; JSX is compiled with the automatic runtime
// because apps/web/tsconfig.json says `jsx: preserve` for Next.js, and `@/` is the web app's src.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  // Agent worktrees under .claude/ hold copies of the repository: never run their tests.
  test: { exclude: [...configDefaults.exclude, "**/.claude/**"] },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) },
  },
});
