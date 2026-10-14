# 18 · Reels: video-first, generated on request

Status: approved by the owner 2026-10-13 (audio placeholder for now; the Spanish Reel reuses the English shots) · Date: 2026-10-13 · Replaces the "carousel → Reel from rendered slides" idea (GROW-04 in `docs/growth/instagram-growth-strategy.md`).

## 18.1 Decisions (owner, 2026-10-13)

| # | Decision |
|---|---|
| RL-1 | A Reel is **video-first**: short AI-animated shots of our own pictures, hard cuts, one big text card per shot, a beat. A slideshow of carousel slides is rejected ("a slideshow, not a Reel"). Accepted reference: the English bulgur test reel, variant B (`spikes/higgsfield-test/bulgur/reel-bulgur-v6B.mp4`, not in git). |
| RL-2 | **On demand only.** Generating a draft never generates a Reel. The owner presses **Generate Reel** for one post (one market's carousel). Nothing is spent until then. |
| RL-3 | The button lives in **both** places: on the market card of the review screen (`/content/review/[ideaId]`) and on the published post screen (`/content/published/[publicationId]`). |
| RL-4 | Cost control = **estimate, no hard cap**. A confirm dialog shows the estimate ("about $1.5: 6 shots of 3 s") before the run; after the run the real cost is shown. Every shot is a `generation_runs` row. |
| RL-5 | The first release includes **publishing** (Instagram `REELS`), behind the existing safeguards (APPROVED only, allowlist, kill switch, `INSTAGRAM_PUBLISH_MODE`, dry run first). |
| RL-6 | Video provider: **Higgsfield API** (`api.higgsfield.ai`), default model `alibaba/wan-3.0` (about $0.04–0.10 per second, cheapest and good enough in the test); Kling 3.0 Std and Seedance 2.0 selectable per request. Behind a provider interface with a fake, like the image provider. |
| RL-7 | Sound: the first release uses the **built-in synthesized beat** as a placeholder; owner-supplied licensed tracks come later (Q-08). Instagram's own music library cannot be added through the API. |

## 18.2 What the owner sees

1. On a market's card: next to the carousel a **Generate Reel** button (disabled with a reason when the carousel is not READY_FOR_REVIEW or later, or when a Reel is already being made).
2. Click → dialog: hook options (3, from the Reel director), the chosen model, the shot count and length, **estimated cost**, a language note. Confirm → the card shows progress built from stages (script → shots 3/6 → assembling → checks), surviving a reload (M6-10 pattern).
3. When ready: a vertical player, the script (scene, text card, emotion, source picture), cost, and actions: **regenerate one shot** (about $0.15–0.5), **change hook**, **download mp4**, **Approve**, **Reject**.
4. Approved → the usual **Schedule / Publish now**; the calendar shows a Reel badge. Published Reels get insights like posts.

## 18.3 Data model (migration 0009_reels)

- `content_variants`: reuse `format = 'REEL'` (enum value exists; unique index `(master_idea_id, market_id, format)` already allows one carousel and one Reel per idea and market). Add nullable `source_variant_id` (the carousel the Reel is built from). `slides_json` is not used for a Reel: the script lives in `reel_scripts`.
- `reel_scripts`: `variant_id`, `version`, `hook_options jsonb`, `chosen_hook`, `scenes jsonb` (per scene: id, beats, emotion, text card, shot prompt, source picture/asset id, claim ids from the post), `cost_estimate_usd`, `model`, `prompt_version`, `generation_run_id`.
- `reel_shots`: `variant_id`, `scene_id`, `prompt_hash`, `provider`, `model`, `provider_request_id`, `status`, `source_asset_id`, `storage_key` (mp4 in R2), `duration_ms`, `cost_usd`, `error`; unique `(variant_id, scene_id, prompt_hash)` for live statuses (a rerun finds the shot instead of paying again, same as `visual_assets_gen_uq`).
- `reel_renders`: `variant_id`, `input_hash`, `storage_key`, `width`, `height`, `duration_ms`, `bytes`, `sha256`, `audio_asset_id`, `cost_usd` (sum of shots), `template_version`; `content_variants.current_render_id` is typed for carousels today, so add `current_reel_render_id`.
- `generation_stage` enum gets `REEL_DIRECTION` and `REEL_SHOT`.
- `audio_tracks` (owner-uploaded, with licence note and BPM) in `source_assets` style or its own table; decided in M8-08.
- All with RLS and no policies (04 §4.1).

## 18.4 Pipeline (job J23 `generate-reel`, queue `render`, machine large, ≤ 25 min)

1. **Director** (`prompts/reel-director@1`, one `runStage`): input = the approved carousel's slides, knowledge ids and market brief; output = `ReelScript`. Rules from the owner's brief and from public short-form hook guides (their statistics are unverified and not used as thresholds): one idea; motion in frame 1; hook = doubt about a familiar action → the rule; one emotion per scene (doubt, intrigue, "aha", appetite peak, usefulness, save); text cards ≤ 6 words inside the safe zone (y 230–1440, right 230 px clear); shots 1.5–2.5 s on a 120 BPM grid; ending echoes the hook; **every claim comes from the carousel's slides** (no new facts, no invented numbers); source picture per shot taken from the carousel's pictures where possible. Deterministic validators (word count, safe zone, grid, claim ids, scene count 6–9, total 12–20 s) with one repair.
2. **Shots**: one Higgsfield image-to-video request per scene (3 s, 720p, "static camera + one concrete motion" prompt rule), padded to 9:16 on white, all in parallel with idempotency keys; download the mp4 into R2 **immediately** (Higgsfield keeps files only temporarily); status `nsfw`/`failed` → one retry with the next fallback prompt, else the shot is marked FAILED and the run stops with a clear error.
3. **Assemble** (ffmpeg + Chromium cards): `colorlevels` to white, 907×1613 box right-aligned or full-bleed, text card PNG per scene (Inter Tight, the carousel palette, safe zone), hard cuts, optional flash opener (variant B), audio mix with cut accents. Output H.264 + AAC, 1080×1920, 30 fps, ≤ 30 s.
4. **Checks** (deterministic): duration, resolution, codec, size, safe-zone mask on the cards, text readability (contrast), no black frames, first-frame motion > threshold; optional vision QA like the carousel's.
5. Variant → READY_FOR_REVIEW through the transition helper (audit event); cost rolled up.

Idempotency: key `reel:{variantId}:{requestId}`; stages persist before the next (resume after a crash); shots reused by prompt hash.

## 18.5 Publishing

- `modules/instagram`: `media_type = REELS` container with `video_url` (presigned R2 GET, TTL 2 h, same rule as carousels, V-14), poll `status_code` (video processing is slower than images: wait up to ~15 min with `wait.for`), `media_publish`, optional `trial_params` (`graduation_strategy`) behind a setting. `share_to_feed` true.
- `publish-content` (J10) gets a format branch; the state machine and `publications` rows stay the same; never retry `media_publish` blindly.
- Safeguards unchanged: APPROVED only, allowlist, kill switch, mode `dry_run_only` first. Dry run for Reels = create the container, wait FINISHED, do not publish.
- Gate **G3** (new) before the first live Reel: V-25/V-26 verified, dry run FINISHED, owner decision recorded in `docs/decisions/G3.md`.

## 18.6 UI, i18n, permissions

- Server action `generateReel({ variantId, hookId?, model?, confirmEstimateUsd })` (thin: validate → one service → job trigger) and `estimateReel({ variantId })`. Owner/editor roles as for regenerate.
- Both languages in `apps/web/src/lib/i18n/{en,ru}.ts` (parity test).
- A `ReelCard` component used by both screens; progress panel like M6-10; player with controls; no autoplay with sound.

## 18.7 Cost model (measured 2026-10-13, 5 s 720p clip from one photo)

| Model | per second | 3 s shot | 7 shots |
|---|---|---|---|
| Wan 3.0 | ~$0.04–0.10 | ~$0.12–0.30 | ~$0.9–2.1 |
| Kling 3.0 Std | ~$0.11 | ~$0.32 | ~$2.3 |
| Seedance 2.0 | ~$0.22 | ~$0.66 | ~$4.6 |

Retries and a regenerated shot add on top. The estimate shown in the dialog = shots × seconds × rate from a table in settings (rates change; promo prices end), plus the director call (~$0.08). Real cost comes from the provider response when available, else from the same table.

## 18.8 Verification items (⚠ before the named task)

- **V-24** (M8-02): Higgsfield API terms: commercial use of outputs, content retention, rate limits, moderation (`nsfw` false positives), request/status schema and error codes. Record in the decision log.
- **V-25** (M8-09): Instagram Reels container rules (`media_type=REELS`, accepted codecs, max length and size, aspect ratio, `video_url` from presigned R2, processing time, `trial_params`) against current official docs.
- **V-26** (M8-09): does Meta fetch the presigned R2 URL for video (V-14 passed for images).
- **V-27** (M8-05): ffmpeg available in Trigger.dev prod machines (ffmpeg build extension), Chromium for text cards alongside; memory and time for a 20 s render.
- **V-28** (M8-08): licence of the track the owner supplies (no copyrighted music without a licence); Instagram does not let API posts use its music library.
- **V-29** (M8-03): `reel-director` through the eval harness (fake + a live run), judged on claim fidelity and hook quality by the owner on 3 real posts.

## 18.9 Tasks (milestone M8 · Reels)

P0 = first release (generate + review + publish). Estimates: S ≤ ½ day, M ≈ 1 day, L ≈ 2–3 days.

- [ ] **M8-01 · Spec and plan** · P0 · S · deps: —
  - **Do:** this file; decision-log entry; `docs/design/reel-style.md` (the accepted format, safe zone, card style); add M8 to `15-task-list.md`, README row 18; V-24…V-29 to 16 §16.4.
  - **Done when:** owner approves; no code.
- [ ] **M8-02 · Video provider** · P0 · M · deps: M8-01 · ⚠ V-24
  - **Do:** `lib/src/providers/video/{types,factory,fake,higgsfield}.ts` (`generateShot`, submit/poll/download, idempotency key, error mapping, cost table); `HIGGSFIELD_API_KEY` in `loadServerEnv` (required when `AI_PROVIDER=live` and Reels enabled); MSW tests; the fake returns a small fixed mp4.
  - **Done when:** tests green without network; a one-shot live script (`pnpm rc reel-smoke`, dry/estimate by default) is documented.
- [ ] **M8-03 · Reel director prompt** · P0 · L · deps: M8-01 · ⚠ V-29
  - **Do:** `prompts/src/reel-director/v1.ts` + schema `ReelScript`, validators, repair, eval set (3 synthetic posts), fake responses; `generation_stage` values; never names a source brand (independent accounts rule).
  - **Done when:** `pnpm eval` fake green; live run recorded; owner reviews 3 scripts.
- [ ] **M8-04 · Data model** · P0 · M · deps: M8-01
  - **Do:** migration 0009 (tables in 18.3), Drizzle schema, enums, RLS, schema tests, transition rules for REEL variants.
- [ ] **M8-05 · Assembly renderer** · P0 · L · deps: M8-04 · ⚠ V-27
  - **Do:** `modules/src/reels/render/` (ffmpeg wrapper, cards via the existing Chromium renderer, box/colour rules, cut grid, audio mix), deterministic input hash; unit tests on the filter graph; a visual test with a fixed fixture clip (golden frames).
- [ ] **M8-06 · Generate service and job J23** · P0 · L · deps: M8-02, M8-03, M8-04, M8-05
  - **Do:** `modules/src/reels/{estimate,generate,shots}.ts`, `jobs/src/tasks/generate-reel.ts`, stages persisted, resume, budget-free estimate, audit events, kill switch `reels.enabled`.
  - **Done when:** an end-to-end test with fakes; a manual live run on one post recorded (cost).
- [ ] **M8-07 · UI: button, dialog, progress, player** · P0 · L · deps: M8-06
  - **Do:** `ReelCard` on review and published screens, estimate dialog, progress, player, regenerate shot, change hook, download; en + ru; component and E2E tests.
- [ ] **M8-08 · Audio** · P0 · M · deps: M8-05 · ⚠ V-28
  - **Do:** owner uploads tracks (rights note, BPM) in Settings; mix with cut accents; fallback synthesized beat; tests.
- [ ] **M8-09 · Review, scheduling and publishing** · P0 · L · deps: M8-06 · ⚠ V-25, V-26
  - **Do:** REEL through approve/schedule/calendar; `modules/instagram` REELS container; J10 format branch; mock Graph API cases; smoke script `pnpm ig:smoke --reel`; runbook `docs/runbooks/reels.md`.
  - **Done when:** dry run FINISHED on the test account; G3 recorded before any live Reel.
- [ ] **M8-10 · Insights for Reels** · P1 · M · deps: M8-09
  - **Do:** Reel metrics (plays, watch time, completion, hook rate where available) in snapshots and dashboards; link Reel ↔ source carousel.
- [ ] **M8-11 · Trial Reels** · P1 · S · deps: M8-09
  - **Do:** `trial_params` toggle per Reel, off by default.

Suggested PR stack (each PR small, `pnpm check` green, merged bottom-up with the upper PR retargeted to `main` first): 1) M8-01 docs · 2) M8-02 provider · 3) M8-04 schema · 4) M8-03 director · 5) M8-05 renderer + M8-08 audio · 6) M8-06 service + job · 7) M8-07 UI · 8) M8-09 publishing · 9) M8-10/11.

## 18.10 Risks

| ID | Risk | Mitigation |
|---|---|---|
| R-21 | Generated shots look wrong (morphing, merged objects, wrong food), so spend is wasted | Prompt rules (static camera + one motion), per-shot regenerate, preview before approval, a shot-level cost shown; fallback to the source photo with a slow zoom for a scene |
| R-22 | Higgsfield queue stalls or the API changes | Timeouts, resume by request id, idempotency key, status in the progress panel; provider interface allows swapping to another vendor |
| R-23 | Instagram rejects the video (codec, length, presigned URL) | V-25/V-26 before G3; encoder profile fixed (H.264 High, yuv420p, AAC, faststart); public-key fallback `RENDERS_PUBLIC_BASE_URL` |
| R-24 | Copyright claim on audio | Only owner-supplied tracks with a licence note; no music generated from unclear sources |
| R-25 | Costs creep with retries (no cap by decision RL-4) | Estimate before, real cost after, per-day total on the settings page; a soft warning line (not a block) when a day's spend passes a configurable value |
| R-26 | Reel claims go beyond the post (fabricated facts) | Claim ids from the carousel's slides required by validator; critic pass on the script; owner approval |

## 18.11 Open questions

- **Q-08** Which licensed tracks will the owner supply (and who holds the licence)? Open; the synthesized beat is the placeholder.
- **Q-09** Voice-over (TTS) in a later stage? Not in the first release.
- **Q-10** Spanish market: **decided** (owner, 2026-10-13): reuse the same shots, only the text cards differ. A Spanish Reel therefore needs an English Reel's shots first, or runs the shots once and shares them (reuse by prompt hash).
