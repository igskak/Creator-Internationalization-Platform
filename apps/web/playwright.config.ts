import { defineConfig } from "@playwright/test";

// E2E tests (plan 13 §13.4). They run against the production build (`pnpm --filter @rc/web build`
// first, or `pnpm e2e` at the repository root) on port 3100 with fakes: AI_PROVIDER=fake (a
// scripted model, see modules/src/ai/e2e-llm.ts), STORAGE_PROVIDER=memory, JOBS_MODE=inline.
// The database and Supabase Auth are the ones of `.env` (a dev project): the tests create their
// own rows and remove them afterwards. The test-login secret exists only for this server process.

export const E2E_PORT = 3100;
export const E2E_SECRET = "e2e-only-secret-never-used-anywhere-else-0123456789";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    // Locally the installed Chrome is used, so no browser download is needed.
    ...(process.env.CI ? {} : { channel: "chrome" }),
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm start --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/api/health`,
    reuseExistingServer: Boolean(process.env.E2E_REUSE_SERVER),
    timeout: 120_000,
    env: {
      APP_ENV: "development",
      AI_PROVIDER: "fake",
      STORAGE_PROVIDER: "memory",
      JOBS_MODE: "inline",
      INSTAGRAM_PUBLISH_MODE: "off",
      E2E_TEST_AUTH_SECRET: E2E_SECRET,
    },
  },
});
