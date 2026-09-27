# RegChef International Content Engine

Internal tool that turns Reg.Chef's Russian-language culinary IP into original Spanish (es-ES) and English Instagram carousels. The implementation plan is in [`docs/plan/`](docs/plan/README.md); working rules for Claude Code are in [`CLAUDE.md`](CLAUDE.md).

## Getting started

Requirements: Node.js 24 LTS (see `.nvmrc`) and pnpm 12 (`npm install -g pnpm@12`).

```bash
pnpm install
cp .env.example .env   # fill in; see comments in the file
pnpm check
```

| Command | What it does |
|---|---|
| `pnpm check` | Biome (format + lint), typecheck of every package, all tests. Must pass before every commit. |
| `pnpm test` | All Vitest tests once (`pnpm test:watch` for watch mode). |
| `pnpm typecheck` | `tsc` in every workspace package. |
| `pnpm lint` | Biome lint only. |
| `pnpm format` | Biome format with write. |

Run one package: `pnpm --filter @rc/lib test`.

## Workspace

| Package | Path | Purpose |
|---|---|---|
| `@rc/web` | `apps/web` | Next.js admin app (placeholder until M0-08) |
| `@rc/modules` | `modules` | Domain services, one subpath per module (`@rc/modules/knowledge`, …) |
| `@rc/lib` | `lib` | Env, logging, errors, security, provider adapters |
| `@rc/db` | `db` | Drizzle schema, migrations, client, test database |
| `@rc/jobs` | `jobs` | Trigger.dev tasks |
| `@rc/prompts` | `prompts` | Versioned prompts |
| `@rc/templates` | `templates` | Carousel slide templates |
| `@rc/evals` | `evals` | Evals (dev only) |

Packages export TypeScript source; there is no build step except for the Next.js app. See [`docs/plan/03-repository-structure.md`](docs/plan/03-repository-structure.md).

`instagram-backup/` is a standalone Python tool and is not part of the pnpm workspace.
