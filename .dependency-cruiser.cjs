// Module boundary rules, plan 02 §2.4 (enforced by M0-20). Run: `pnpm deps:check`.
// Workspace packages resolve through node_modules symlinks to their real folders, so the
// paths below are repo-relative (modules/, lib/, db/, ...).

/** Domain folders under modules/src that may depend on each other (02 §2.4). */
const DOMAIN_ALLOWED = {
  content: ["knowledge", "localization", "offers", "visuals", "ai"],
  publishing: ["content", "instagram"],
  analytics: ["publishing", "instagram", "content"],
};

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "No runtime cycles anywhere (02 §2.4); cycles closed only by `import type` are erased at compile time.",
      severity: "error",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "modules-not-from-apps-or-jobs",
      comment: "@rc/modules never imports apps/* or jobs (02 §2.4).",
      severity: "error",
      from: { path: "^modules/" },
      to: { path: "^(apps|jobs|cli)/" },
    },
    {
      name: "modules-allowed-packages",
      comment:
        "@rc/modules may import only @rc/db, @rc/lib, @rc/prompts, @rc/templates (not evals).",
      severity: "error",
      from: { path: "^modules/src/", pathNot: "\\.test\\.ts$" },
      to: { path: "^evals/" },
    },
    {
      name: "core-depends-on-nothing-in-modules",
      comment: "modules/core must not import any other module (02 §2.4).",
      severity: "error",
      from: { path: "^modules/src/core/", pathNot: "\\.test\\.ts$" },
      to: { path: "^modules/src/(?!core/)[^/]+" },
    },
    ...Object.keys(DOMAIN_ALLOWED).map((domain) => ({
      name: `modules-${domain}-allowed-deps`,
      comment: `modules/${domain} may depend only on: ${DOMAIN_ALLOWED[domain].join(", ")} (and core, db, lib).`,
      severity: "error",
      from: { path: `^modules/src/${domain}/` },
      to: {
        path: "^modules/src/[^/]+/",
        pathNot: [`^modules/src/(${[domain, "core", ...DOMAIN_ALLOWED[domain]].join("|")})/`],
      },
    })),
    {
      name: "modules-leaf-domains",
      comment: "Domains with no allowed module deps may import only core and themselves (02 §2.4).",
      severity: "error",
      from: {
        path: "^modules/src/(knowledge|localization|offers|visuals|ai|instagram|settings)/",
      },
      to: { path: "^modules/src/[^/]+/", pathNot: "^modules/src/(core|$1)/" },
    },
    {
      name: "web-and-jobs-via-public-api",
      comment:
        "apps/web and jobs reach domain code only through @rc/modules subpaths (package exports), never deep files.",
      severity: "error",
      from: { path: "^(apps/web/src|jobs/src|cli/src)/" },
      to: {
        path: "^modules/src/",
        pathNot: "^modules/src/(([^/]+)/index|job-handlers|cli-commands)\\.ts$",
      },
    },
    {
      name: "web-and-jobs-no-db-at-runtime",
      comment:
        "apps/web and jobs use @rc/db only for types, except the composition roots (runtime.ts, cli/src/main.ts).",
      severity: "error",
      from: {
        path: "^(apps/web/src|jobs/src|cli/src)/",
        pathNot: "^((apps/web/src/server|jobs/src)/runtime|cli/src/main)\\.ts$",
      },
      to: { path: "^db/", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "web-and-jobs-not-each-other",
      comment: "apps/web and jobs never import each other.",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^jobs/" },
    },
    {
      name: "jobs-not-from-web",
      comment: "jobs never imports apps/web.",
      severity: "error",
      from: { path: "^jobs/" },
      to: { path: "^apps/" },
    },
    {
      name: "lib-is-a-leaf",
      comment: "@rc/lib imports no other workspace package.",
      severity: "error",
      from: { path: "^lib/src/" },
      to: { path: "^(apps|jobs|modules|db|prompts|templates|evals)/" },
    },
    {
      name: "db-only-lib",
      comment: "@rc/db imports only @rc/lib among workspace packages.",
      severity: "error",
      from: { path: "^db/" },
      to: { path: "^(apps|jobs|modules|prompts|templates|evals)/" },
    },
    {
      name: "templates-are-pure",
      comment: "@rc/templates is pure: no db, no network, no other workspace package (02 §2.4).",
      severity: "error",
      from: { path: "^templates/" },
      to: { path: "^(apps|jobs|modules|db|lib|prompts|evals)/" },
    },
    {
      name: "prompts-are-pure",
      comment: "@rc/prompts has no side effects: no db, no modules, no apps.",
      severity: "error",
      from: { path: "^prompts/" },
      to: { path: "^(apps|jobs|modules|db|templates|evals)/" },
    },
    {
      name: "web-no-visuals-render",
      comment:
        "apps/web never imports modules/visuals/render (Chromium); only InlineJobRunner via dynamic import (02 §2.4).",
      severity: "error",
      from: { path: "^apps/web/src/" },
      to: { path: "^modules/src/visuals/render" },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules", "\\.next"] },
    exclude: { path: ["\\.next/", "\\.trigger/", "/node_modules/"] },
    tsPreCompilationDeps: true,
    parser: "swc",
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
    combinedDependencies: false,
    reporterOptions: { text: { highlightFocused: true } },
  },
};
