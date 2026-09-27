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
