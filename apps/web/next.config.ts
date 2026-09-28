import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { securityHeaders } from "./src/server/security-headers";

const config = (phase: string): NextConfig => ({
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages export TypeScript source (plan 03 §3.2).
  transpilePackages: ["@rc/lib", "@rc/modules", "@rc/db", "@rc/prompts", "@rc/templates"],
  serverExternalPackages: ["sharp", "playwright-core"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ dev: phase === "phase-development-server" }),
      },
    ];
  },
});

// Release = git SHA (12 §12.9). Source maps are uploaded only when SENTRY_AUTH_TOKEN is set
// (CI / Vercel); builds without it (local, PR CI) skip the upload.
const release = process.env.APP_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA;

const { SENTRY_ORG: org, SENTRY_PROJECT: project, SENTRY_AUTH_TOKEN: authToken } = process.env;

export default withSentryConfig(config, {
  ...(org ? { org } : {}),
  ...(project ? { project } : {}),
  ...(authToken ? { authToken } : {}),
  silent: true,
  telemetry: false,
  ...(release ? { release: { name: release } } : {}),
  sourcemaps: { disable: !authToken },
});
