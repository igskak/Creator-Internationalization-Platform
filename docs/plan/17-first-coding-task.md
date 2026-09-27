# 17 · First coding task to start with

Spec §23.1 item 17 (§23 item 18).

## 17.1 Recommendation
1. **Code: start with M0-01 — workspace scaffold and tooling.** It has no external dependency (no accounts, no keys) and every other task builds on it.
2. **Same week, non-code (Track B):** B-01 (make the repository private), B-02 (cloud accounts), B-03 (AI keys + data terms), B-04 (rights matrix), B-05 (one real book/guide), B-11 (Meta apps and Instagram Professional accounts — long lead time), B-14 (allow docs domains in the Claude Code environment).
3. **As soon as B-03/B-04/B-05 are ready: S-01 spike.** One real PDF → cards → one idea → ES and EN drafts. This is the earliest possible test of the product's core bet [S§24 priority reminder]. Its learnings feed prompts v1 (M1-12, M2-09, M2-10).
4. Then follow the task list in order. Do **not** start Instagram work (M5) before G1 [S§23.2], except the Meta verification pass and app setup, which have long lead times.

## 17.2 First two weeks (one engineer)

| Day | Tasks | Output |
|---|---|---|
| 1 | M0-01, M0-02 | Workspace + CI green |
| 2 | M0-03, M0-04, M0-05, M0-06 | Cloud sessions ready; env, logging, errors |
| 3 | M0-07, M0-08 | Crypto utils; Next.js app builds |
| 4 | M0-09, M0-10 | DB package, PGlite tests, core schema |
| 5 | M0-11, M0-12, M0-13 | Seeds, core services, storage |
| 6 | M0-14, S-01 (if keys and source ready) | Job runner; first real AI outputs |
| 7 | M0-15, M0-16 | Login + actions framework |
| 8 | M0-17, M0-18, M0-19 | Shell, brand/market settings, Sentry → **M0 done** |
| 9–10 | M1-01, M1-02, M1-08, M1-09 | Knowledge schema, rights, LLM adapter, prompts package |

## 17.3 Copy-paste prompt for the first Claude Code session

```
Implement task M0-01 from docs/plan/15-task-list.md.

Before coding, read: CLAUDE.md, docs/plan/03-repository-structure.md (sections 3.1–3.3),
and the M0-01 entry in docs/plan/15-task-list.md.

Scope: workspace scaffold and tooling only. Do NOT create the Next.js app (M0-08),
the database code (M0-09) or any business logic.

Create:
- Root: package.json (private, packageManager pnpm, engines.node = current LTS,
  scripts: check, test, lint, format, typecheck), pnpm-workspace.yaml
  (apps/*, modules, lib, db, jobs, prompts, templates, evals), tsconfig.base.json
  (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, moduleResolution bundler),
  biome.json, vitest.workspace.ts, .editorconfig, .nvmrc, .gitignore
  (.env* except .env.example, node_modules, .next, spikes/**/out, evals/results).
- Packages @rc/web (placeholder in apps/web), @rc/modules, @rc/lib, @rc/db, @rc/jobs,
  @rc/prompts, @rc/templates, @rc/evals: each with package.json ("type": "module",
  exports pointing to TypeScript source; @rc/modules exposes subpaths ./core, ./ai,
  ./knowledge, ./content, ./localization, ./visuals, ./offers, ./publishing, ./instagram,
  ./analytics), tsconfig.json extending the base, src/index.ts, and one trivial Vitest test.
- README.md "Getting started" with the commands.

Use current stable versions of pnpm, TypeScript, Biome and Vitest.

Done when: `pnpm install && pnpm check` passes. Then tick M0-01 in
docs/plan/15-task-list.md, note any deviation in docs/plan/decision-log.md, and commit as
`chore(repo): workspace scaffold and tooling [M0-01]`.
```

## 17.4 Prompt pattern for every later task

```
Implement task <ID> from docs/plan/15-task-list.md.
Read CLAUDE.md, the <ID> entry and every section listed in its Refs before coding.
Stay inside the task scope; if something is missing, add a follow-up task instead of widening this one.
If the task has ⚠ items, verify them against the official docs first and record the result in docs/plan/decision-log.md.
Finish with the Definition of Done in docs/plan/14-milestones.md §14.7, tick the box, and commit as
`<type>(<scope>): <summary> [<ID>]`.
```
