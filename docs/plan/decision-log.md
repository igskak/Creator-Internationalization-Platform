# Decision log

Record here: deviations from the plan, results of ⚠ verification items (V-xx), gate outcomes, prompt/model activations, and scope changes. Newest entry first. One entry per decision.

Template:
```
## YYYY-MM-DD · <short title> [<task or V-id>]
- Context: …
- Decision: …
- Evidence / links: …
- Impact on plan: <files/sections/tasks changed>
```

---

## 2026-09-27 · Toolchain versions and scaffold deviations [M0-01]
- Context: M0-01 asks for current stable pnpm, TypeScript, Biome and Vitest, Node LTS, and a `vitest.workspace.ts`.
- Decision:
  - Versions: pnpm 12.6.0 (`packageManager`), TypeScript 7.0.2 (native compiler), Biome 2.5.14, Vitest 5.0.2, `@types/node` 24. Node 24 LTS in `.nvmrc`; `engines.node` is `>=24`.
  - Vitest 5 no longer supports `vitest.workspace.ts`. Root `vitest.config.ts` lists every package in `test.projects` instead.
  - `@rc/modules` exports only the ten module subpaths (`./core` … `./analytics`) and has no root `src/index.ts` barrel, so callers cannot import the whole domain layer at once. Its test checks that every subpath resolves.
  - Typecheck runs `tsc -p .` per package (`pnpm -r typecheck`) instead of project references; packages have no emit step.
  - `instagram-backup/` (standalone Python tool committed before the plan) stays outside the pnpm workspace and is excluded from Biome.
- Evidence / links: `npm view` on 2026-09-27; Vitest 5 config types expose `test.projects` and no `workspace` option. Vitest 5 `engines` = Node `^22.12 || ^24 || >=26`; `pnpm check` also passes on the owner's local Node 25.2.1, but Node 25 is past end-of-life, so switch the machine to Node 24.
- Impact on plan: 03 §3.1 tree and the M0-01 entry in 15 now name `vitest.config.ts`.

## 2026-09-27 · Work continues from the owner's local folder
- Context: the GitHub repository is public; the spec is an internal document; the owner decided to continue from a local folder and push/PR from there.
- Decision: the plan was delivered as an archive for the local folder instead of being pushed from the cloud session. The spec is stored locally in `docs/spec/` and ignored by `docs/spec/.gitignore`. Making the repository private before the first push is still recommended (B-01, R-17).
- Evidence / links: –
- Impact on plan: `CLAUDE.md`, `03-repository-structure.md`, `README.md` point to the local spec copy.

## 2026-09-27 · Plan v0.1 created
- Context: implementation plan produced from the MVP spec v0.1 (§23).
- Decision: material choices pending confirmation by the owner: D-05 (Trigger.dev), D-08 (Claude `claude-opus-5` for all stages), D-09/D-10 (OpenAI for embeddings and first image adapter), D-11 (inline embeddings), D-13 (Playwright renderer), D-14 (Instagram API with Instagram Login), D-16 (knowledge cards in source language). See 16 §16.5.
- Evidence / links: Meta and Trigger.dev facts in the plan come from secondary sources (official docs were not reachable from the planning environment) and are marked ⚠ V-xx.
- Impact on plan: none yet.
