# 13 · Testing strategy

Spec §23.1 item 13 (§23 item 14). Principle: CI is deterministic and free — no paid API calls, no network to Meta/Anthropic/OpenAI. Real-provider checks run as evals and smoke tests on demand.

## 13.1 Layers and tools

| Layer | Tool | Runs where | Scope |
|---|---|---|---|
| Unit | Vitest | every PR | pure logic: validators, units, state machines, quote matching, differentiation math, error classification, crypto, redaction, slot schedule, policy |
| Integration | Vitest + PGlite + fake providers + MSW | every PR | services with a real schema: ingestion, pipelines, transitions, publish machine, insights, queries |
| Provider contract | Vitest + MSW | every PR | adapters send the right request shape and map responses/errors (Anthropic, OpenAI, Meta, R2) |
| E2E | Playwright Test | PR (smoke subset) + nightly (full) | real Next.js app, Postgres, inline jobs, fake AI, in-memory/fake storage |
| Rendering regression | Playwright + pixelmatch | when `templates/**` changes + nightly | golden slide images per template |
| Prompt evals | `pnpm eval` (real Claude) | manual / before activating prompt versions / gates | quality metrics (07 §7.12) |
| Instagram | MSW (CI) + dry runs + smoke script on test accounts | CI / manual | 13.6 |
| Security | Vitest + scripts | PR / H-02 | redaction, auth guard, signed_request, RLS anon check |

## 13.2 Unit tests (examples that must exist)
- `localization/units`: conversions and market formatting (es-ES decimal comma, `º` vs `°`, DUAL order).
- `numeric-fidelity`: extraction from ES/EN text; tolerance rules; ranges.
- `verify-quote`: hyphenation, soft hyphens, `ё/е`, quotes and dashes, fuzzy threshold, Cyrillic.
- `content/validation`: every validator with pass/fail cases; slot limits from the template registry.
- `policy`: verdict table (unsupported claim, blocker, diff FAIL, low scores, safety flag, max iterations).
- `state` modules: full transition matrix for cards, ideas, variants, publications (allowed and refused).
- `instagram/errors`: classification table.
- `analytics/slots`: due-slot computation with late and missed slots.
- `security`: AES-GCM round trip, tamper, wrong AAD, key rotation; HMAC state; redaction and URL scrubbing (incl. `X-Amz-Signature`).

## 13.3 Integration tests
- **DB**: `createTestDb()` spins up PGlite with pgvector and all migrations (per test file, ~1 s). Seeds via factories (`db/src/testing/factories.ts`).
- **Fakes**: `FakeLLMProvider` (fixtures by prompt id + input hash, or inline handler), `FakeEmbeddingProvider` (deterministic vectors — similar texts can be forced similar), `FakeImageProvider`, in-memory `StorageProvider`, `InlineJobRunner`.
- **MSW** handlers for Meta Graph API (every publishing step, every error class, insights variants), OpenAI, Anthropic (adapter tests only).
- Key scenarios:
  - Ingestion: PDF fixture → pages → batches → cards → verification flags → READY; rights BLOCKED; one batch fails → READY with partial result.
  - Pipeline: happy path; rewrite path; FLAG_FOR_HUMAN path; resume after a simulated crash (stage outputs reused); generation failure → DRAFT + flag.
  - Review: edit invalidates approval and cancels publication; stale lockVersion → CONFLICT; approve blocked by flags.
  - Publish machine: happy path; IN_PROGRESS → FINISHED; EXPIRED → recreate once; ERROR → FAILED; 190 → NEEDS_REAUTH; rate limit → retry; **crash after `media_publish` → reconcile, no second publish**; dry run; wrong market account refused.
  - Dispatcher: claims each due publication once; kill switch respected; stuck recovery.
  - Insights: slots created once; unsupported metric removed and cached; late slot stored with real age.
- **Concurrency** (real Postgres only, CI service container): two dispatchers in parallel never claim the same publication; unique index blocks a second live publication.

## 13.4 E2E tests (Playwright Test)
- **Environment**: Next.js production build; Postgres (CI: `pgvector/pgvector` service container; local/Claude Code: PGlite socket server ⚠ verify, or a dev Supabase DB); `JOBS_MODE=inline`; `AI_PROVIDER=fake`; `STORAGE_PROVIDER=memory`; Meta calls go to a local mock Graph API server (the MSW handlers served over HTTP, started by Playwright's `webServer`) through `INSTAGRAM_GRAPH_BASE_URL`; `INSTAGRAM_PUBLISH_MODE=live` only against that mock.
- **Auth**: test login route enabled only by `E2E_TEST_AUTH_SECRET` in non-production (12 §12.5).
- **Specs**:
  1. Upload source (fake) → cards appear → edit → approve (chef).
  2. Generate ideas → accept → generate ES + EN drafts → review screen shows both, flags and critic panel.
  3. Edit hook → regenerate slide → approve with checklist → schedule → calendar shows it.
  4. Publish (mock Graph API) → PUBLISHED → lineage page shows source → cards → idea → version → publication.
  5. Settings: kill switch off → publish blocked with a clear message.
- In Claude Code cloud sessions use the pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH`); do not run `playwright install`.

## 13.5 Prompt and evaluation tests (07 §7.12)
- Deterministic prompt tests in CI: rendered prompt snapshot per version (catches accidental edits of released versions), schema round-trip of fixture outputs.
- Evals with the real model: `pnpm eval -- --stage content-writer --set gate1` (manual; cost printed before running).
- Metrics tracked per run and stored in `evals/results/` (git-ignored if real content): schema-valid rate, citation coverage, numeric fidelity, unsupported claims (judge), localization and voice (judge), differentiation, cost, latency.
- **Rule**: no prompt/model change becomes active without an eval run that shows no regression (decision-log entry).
- Human evaluation at G1: blind ES/EN pairs scored by native reviewers (rubric in M2-18).

## 13.6 Instagram test strategy (there is no Instagram sandbox)
1. **CI**: MSW fixtures only (13.3).
2. **Dev Meta app** (Development mode) + dedicated **test professional accounts** (e.g. `regchef_test_es`, `regchef_test_en`) with roles on the app. Professional accounts are public, so test posts are visible — keep test accounts low profile.
3. **Dry run** (`dry_run_only`): full flow up to container FINISHED, no post. Used on test accounts in CI-like manual runs and on production accounts before G2.
4. **Smoke script** `pnpm ig:smoke --account <id> [--live]` (M5-10): token check → publishing limit → children + carousel container from a fixture render → status → (live) publish → permalink → insights call. Results recorded in `docs/runbooks/instagram-smoke.md`.
5. **Idempotency drill** (G2): trigger `publish-content` twice for the same publication and kill the worker between PUBLISH and FINALIZE → exactly one post.
6. Test posts cannot be deleted through the API (assumed ⚠ V-15) → delete by hand in the Instagram app.
7. Production accounts: first posts only after G2, one market at a time, with Sergey's approval.

## 13.7 CI pipeline (`.github/workflows/ci.yml`)

| Stage | Trigger | Steps | Blocking |
|---|---|---|---|
| Static | every PR | `pnpm install --frozen-lockfile` → biome check → typecheck → dependency rules (M0-20) | yes |
| Tests | every PR | unit + integration (PGlite) + contract (MSW) | yes |
| Build | every PR | `next build`; `trigger deploy --dry-run` (if supported ⚠ V-17) | yes |
| Concurrency tests | every PR touching `publishing/` or `db/` | Postgres service container | yes |
| Visual regression | PR touching `templates/**` | render goldens + compare | yes |
| E2E smoke | every PR (specs 2–3) | Playwright | yes |
| Nightly | schedule | full E2E + visual regression + dependency audit | report |
| Deploy | merge to `main` | migrate (expand-only) → `trigger deploy` → Vercel prod | – |

## 13.8 Acceptance test plan (H-04)

| Spec §17 criterion | How it is verified |
|---|---|
| 1 Upload a real source | Manual run in prod (or dev with real data) + audit event |
| 2 Structured knowledge with traceable references | Cards show page + verified quote; spot-check 20 cards |
| 3 Review/approve cards | Chef approves in UI; versions recorded |
| 4 Master Idea grounded in knowledge | Idea links only CHEF_APPROVED cards (DB check) |
| 5 ES + EN variant from the same idea | Review screen shows both; same `master_idea_id` |
| 6 Materially different, same expertise | Differentiation report OK/WARN + native reviewer check; critic factual fidelity ≥ 4 |
| 7 Finished carousel per market | Renders READY, QA report clean, 1080×1350 JPEGs |
| 8 Edit/regenerate fields and approve | `review_events` rows exist; approved snapshot |
| 9 Approved content can be scheduled | Publication SCHEDULED in calendar |
| 10 Published via official API | `publish_attempts` show Graph API calls; permalink opens |
| 11 Platform IDs and status stored | `instagram_media_id`, `permalink`, status PUBLISHED |
| 12 Metrics retrieved later | D1 (and later) snapshots exist |
| 13 Metrics linked to dimensions and idea | Lineage view + content-learning query return the post |
| 14 Edits and rejection reasons kept | `review_events` with reason codes; Operations tab |

| Spec §18 test | Verification |
|---|---|
| Knowledge grounding | Critic unsupported claims = 0 on approved posts; numeric fidelity check; G1 human check |
| Source traceability | Every factual slide cites cards; cards have page + quote |
| Localization | Native reviewer score ≥ 4/5 (G1) |
| Cross-market originality | Differentiation thresholds + human "not a translation" check |
| Brand voice | ≥ 70 % of variants approvable with ≤ 3 edits (G1), tracked in Operations |
| Rendering | QA checks + visual regression |
| Publishing | Idempotency drill; unique constraints; MSW tests |
| Analytics | Unique slot per publication; lineage query |
| Human feedback | `review_events` structure + Operations tab queries |

## 13.9 Test data policy
- Repository fixtures are synthetic culinary texts, images and posts written for tests. **No Reg.Chef IP in git** (the repository may be public; R-17).
- Real data for evals and G1 lives in the dev environment (DB + R2) or private storage, referenced by path/ID.
- `spikes/**/out/`, `evals/results/` and any file with real content are git-ignored.
