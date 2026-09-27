import { defineConfig } from "drizzle-kit";

// Used by `pnpm db:generate` only; migrations are applied by src/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
});
