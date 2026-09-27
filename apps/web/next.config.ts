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

export default config;
