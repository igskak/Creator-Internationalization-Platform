# Synthetic eval set

Three cases written for this project (not Reg.Chef material). They exist to prove the harness and to give a quick regression signal: one myth (`rice-not-rinsed`), one technique with exact numbers (`buckwheat-lid`) and one safety-sensitive card (`rice-storage-safety`). Run them with `pnpm eval` (fake model, no cost) or `pnpm eval --provider live --judge` (real model, asks for confirmation first). Real cases belong outside git: pass their folder with `--set /path/to/set`.
