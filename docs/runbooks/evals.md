# Evals (`pnpm eval`)

Plan 07 §7.12, task M2-16. The harness runs **cases** through the real variant pipeline (adapter → writer → critic loop) in a throw-away database and measures the result. Use it before activating a new prompt version or model, and for Gate G1.

## Run

```bash
pnpm eval                                   # synthetic set, scripted fake model: free, proves the harness
pnpm eval --judge --blind --g1              # also score with eval-judge@1 and write the blind review sheet
pnpm eval --provider live --judge           # the real model of .env (AI_PROVIDER=live): prints an estimate and asks
pnpm eval --provider live --yes --set /path/to/private/set --cases a,b
```

A live run costs money, so it never runs in PR CI. The fake run is what the unit tests execute (`evals/src/eval.test.ts`). Results go to `evals/results/` (not in git): one JSON per run, and with `--blind` a Markdown sheet, a CSV and a key.

## A case (`<set>/cases/*.json`)

An idea, the approved cards it rests on (`key`, role, claim, numbers), the markets (default `es-ES` and `en`), optional market notes (tone, vocabulary, forbidden patterns) and expectations: `mustCite` (card keys every draft must cite), `forbiddenPhrases`, `requiredText` (for example a numeric fact such as `180 °C`), `hookTypesDiffer`. The schema is `evals/src/case.ts`. Cases in the repository are synthetic (`evals/sets/synthetic`); real Reg.Chef cases live outside git and are passed with `--set <folder>`.

## Metrics

Completion rate, schema-valid rate of the model runs (and how many needed the repair), citation coverage of factual slides, numeric fidelity, unsupported claims (critic and judge), critic quality score, judge scores (factual fidelity, localization, voice), the worst cross-market comparison, rewrites, flags, cost and time per idea, and whether each case meets its expectations. The exit code is 1 when a case does not.

## Gate G1

`--g1` prints the part of Gate G1 that numbers can decide (grounding, numeric fidelity, differentiation, time and cost; it fails a fake run on purpose). The reviewers' criteria stay open. The record and the steps are in `docs/decisions/G1.md`.

## Blind review (Gate G1)

`--blind` writes, per idea, two items A and B (the two markets in a seeded random order, no market code, no scores), a CSV to fill in (`reads_as_native_1_5`, `not_a_translation_of_the_other_yes_no`, `approvable_yes_no`, `field_edits_needed`, `comments`) and `*-blind-key.json`, which says which item is which market. Give the reviewers the Markdown and the CSV; keep the key. Humans spot-check 20 % of the judge's verdicts.
