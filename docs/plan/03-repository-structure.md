# 03 · Repository structure

Spec §23.1 item 3. The layout keeps the top-level folders suggested in [S§15] and turns each into a workspace package. This enforces boundaries (D-01) without changing the spec's idea.

## 3.1 Tree

```
/
├─ CLAUDE.md                     # working rules for Claude Code sessions (short)
├─ README.md
├─ package.json                  # workspace scripts: dev, build, check, test, db:*, jobs:*, eval
├─ pnpm-workspace.yaml           # apps/*, modules, lib, db, jobs, prompts, templates, evals
├─ tsconfig.base.json            # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
├─ biome.json
├─ vitest.config.ts            # test.projects = every workspace package
├─ .env.example                  # every variable, grouped, with comments (no values)
├─ .github/workflows/ci.yml
├─ .claude/settings.json         # SessionStart hook for Claude Code on the web (M0-03)
├─ scripts/                      # claude/session-start.sh, ig-smoke.ts, reencrypt-tokens.ts
├─ docs/
│  ├─ spec/                      # the MVP spec as Markdown — local only; git-ignored while the repo is public
│  ├─ plan/                      # this plan (01–17) + decision-log.md
│  ├─ decisions/                 # gate records (G1, G2), bake-off results
│  └─ runbooks/                  # meta-app-setup, r2-setup, publishing-incidents, token-reauth, …
├─ apps/
│  └─ web/                       # @rc/web
│     ├─ next.config.ts          # transpilePackages, serverExternalPackages, security headers
│     ├─ src/proxy.ts            # session check (Next.js 16 renamed middleware → proxy; V-21 done)
│     ├─ src/app/(auth)/login/…
│     ├─ src/app/(app)/layout.tsx                 # shell, nav, health banners
│     ├─ src/app/(app)/dashboard/page.tsx
│     ├─ src/app/(app)/content/{ideas,drafts,review/[ideaId],calendar,published}/…
│     ├─ src/app/(app)/knowledge/{sources,cards,offers,posts}/…
│     ├─ src/app/(app)/markets/[marketCode]/…
│     ├─ src/app/(app)/{analytics,experiments}/…
│     ├─ src/app/(app)/settings/{instagram,brand,ai,health}/…
│     ├─ src/app/api/instagram/oauth/{start,callback}/route.ts
│     ├─ src/app/api/meta/{deauthorize,data-deletion}/route.ts
│     ├─ src/app/api/preview/slide/route.ts
│     ├─ src/app/api/health/route.ts
│     ├─ src/server/actions/<area>.ts             # thin server actions (defineAction)
│     ├─ src/server/context.ts                    # builds ServiceContext per request
│     ├─ src/components/{ui,review,carousel,calendar,knowledge,charts}/…
│     └─ e2e/                                     # Playwright Test specs
├─ modules/                      # @rc/modules  (subpath exports: @rc/modules/knowledge, …)
│  └─ src/
│     ├─ core/        context.ts · audit.ts · transition.ts · action-errors.ts · job-runner.ts
│     ├─ ai/          run-stage.ts · repair.ts · cost.ts · config.ts (stage → prompt/model/effort) · version.ts
│     ├─ knowledge/   sources/ · rights/ · ingestion/{sniff,pdf,docx,text,transcript}.ts · chunking/
│     │               extraction/{plan,batch,verify-quote}.ts · cards/{service,state,versions}.ts
│     │               retrieval/ · dedupe/ · posts/
│     ├─ offers/      products.ts · offers.ts · campaigns.ts · utm.ts
│     ├─ localization/ markets.ts · units.ts · numeric-fidelity.ts · differentiation.ts
│     ├─ content/     ideas/ · pipeline/{generate-variants,adapter,writer,critic,policy}.ts
│     │               validation/ · variants/{state,field-path,edit,regenerate,approve}.ts · voice/
│     ├─ visuals/     director/ · images/{generate,normalize,phash}.ts · library/ · render/{renderer,qa}.ts
│     ├─ publishing/  schedule.ts · dispatcher.ts · publish-machine.ts · safeguards.ts · kill-switch.ts
│     ├─ instagram/   http.ts · oauth.ts · tokens.ts · containers.ts · insights.ts · errors.ts · fixtures/
│     ├─ analytics/   snapshots.ts · slots.ts · queries/ · summaries/ · attribution.ts · experiments.ts
│     └─ job-handlers.ts          # job name → service function (used by jobs and InlineJobRunner)
├─ jobs/                         # @rc/jobs
│  ├─ trigger.config.ts          # project ref, dirs, build extensions (playwright), retry defaults
│  └─ src/{ingest-source,extract-knowledge-batch,embed-knowledge-items,generate-ideas,
│         generate-content,regenerate-field,generate-visual-assets,render-carousel,
│         publish-dispatcher,publish-content,collect-insights,collect-account-insights,
│         refresh-instagram-tokens,check-account-health,build-performance-summary,
│         import-historical-posts,annotate-historical-posts}.ts  + queues.ts
├─ prompts/                      # @rc/prompts
│  └─ src/ define-prompt.ts · registry.ts · render.ts
│         knowledge-extractor/v1.ts · idea-generator/v1.ts · market-adapter/v1.ts ·
│         content-writer/v1.ts · critic/v1.ts · visual-director/v1.ts · field-regenerator/v1.ts ·
│         post-annotator/v1.ts · knowledge-gloss/v1.ts · visual-qa/v1.ts · eval-judge/v1.ts
│         (each folder: vN.ts + schema.ts + fixtures/)
├─ templates/                    # @rc/templates
│  ├─ src/ define-template.ts · registry.ts · theme.ts · slide-document.tsx · render-html.ts ·
│  │       fit-text.client.js · glyphs.ts
│  ├─ src/carousel-{a,b,c,d,e,f}/  Template.tsx · styles.css · fixtures.json
│  └─ assets/{fonts,logo,icons}/
├─ db/                           # @rc/db
│  ├─ drizzle.config.ts
│  ├─ src/schema/{core,knowledge,content,creative,review,instagram,analytics,learning}.ts
│  ├─ src/json/*.ts              # Zod schemas for every jsonb column
│  ├─ src/client.ts · test-db.ts (PGlite) · migrate.ts
│  ├─ src/seed/{brand,markets,taxonomy,users}.ts
│  └─ migrations/0000_extensions.sql … 0008_learning.sql
├─ lib/                          # @rc/lib
│  └─ src/ env/ · logging/ · errors/ · security/{crypto,redact,hmac}.ts · validation/ ·
│          providers/{llm,embeddings,image,storage}/{types.ts,anthropic.ts|openai.ts|r2.ts,fake.ts}
├─ evals/                        # @rc/evals — datasets (synthetic or private), runner, judge, reports
│  └─ sets/ · run.ts · results/ (git-ignored if they contain real Reg.Chef content)
└─ spikes/                       # throwaway experiments (S-01); outputs git-ignored
```

## 3.2 Packages

| Package | Path | Build | Exports | Notes |
|---|---|---|---|---|
| `@rc/web` | `apps/web` | `next build` | – | Only package deployed to Vercel |
| `@rc/jobs` | `jobs` | `trigger deploy` | task types | Imports services from `@rc/modules/*` |
| `@rc/modules` | `modules` | none (TS source consumed directly) | subpaths per module | Every entry file starts with `import 'server-only'` equivalent guard for Next.js |
| `@rc/db` | `db` | none | `schema`, `client`, `json`, `testDb` | drizzle-kit runs from here |
| `@rc/lib` | `lib` | none | `env`, `logger`, `errors`, `security`, `providers/*` | – |
| `@rc/prompts` | `prompts` | none | `registry`, prompt types | Prompt text lives in TS files (bundles cleanly; no fs reads at runtime) |
| `@rc/templates` | `templates` | none | `registry`, `renderSlideHtml`, components | Font files are imported as assets by the renderer |
| `@rc/evals` | `evals` | none | – | Dev-only |

"Internal packages" pattern: packages export TypeScript source. Next.js compiles them via `transpilePackages`; Trigger.dev bundles them with esbuild; Vitest runs them directly.

## 3.3 Conventions
- **Naming.** Files `kebab-case.ts`; React components `PascalCase.tsx`; DB columns `snake_case`; TS properties `camelCase` (Drizzle maps them).
- **Service signature.** `export async function approveVariant(ctx: ServiceContext, input: ApproveVariantInput): Promise<ApproveVariantResult>`. Services never read env or globals; everything comes from `ctx`.
- **Tests.** Co-located `*.test.ts`. Integration tests that need a DB use `createTestDb()` (PGlite with all migrations). No test calls a paid API.
- **Fixtures.** Synthetic culinary texts written for tests. No Reg.Chef intellectual property in the repository (it may be public; see 16 R-17).
- **Env.** Only `@rc/lib/env` reads `process.env`. Every new variable goes into `.env.example` in the same PR.
- **Migrations.** Generated with drizzle-kit, reviewed by hand, never edited after merge. Custom SQL (RLS, triggers, special indexes) in the same numbered migration.
- **Commits.** `type(scope): summary [TASK-ID]`, e.g. `feat(knowledge): verify quotes against page text [M1-14]`.
- **Scripts (root).** `pnpm dev` (web + inline jobs), `pnpm jobs:dev` (Trigger.dev dev CLI), `pnpm check` (biome + typecheck + tests), `pnpm test`, `pnpm test:e2e`, `pnpm test:visual`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm eval -- --stage <id> --set <name>`, `pnpm rc <command>` (dev CLI, M0-21).
