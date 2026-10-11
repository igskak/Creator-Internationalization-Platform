import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// The same settings as the root config, for `pnpm --filter @rc/web test` run inside apps/web.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  // Agent worktrees under .claude/ hold copies of the repository: never run their tests.
  test: { exclude: [...configDefaults.exclude, "**/.claude/**"] },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
