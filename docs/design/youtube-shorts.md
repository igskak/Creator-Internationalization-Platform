# YouTube Shorts: the same Reel, a second destination

Status: design + code behind a switch that is off (task G-09, 2026-10-17). Nothing is uploaded until the owner sets the environment and the setting and says yes to the first live upload (runbook `docs/runbooks/youtube-shorts.md`).

## Why

A Reel costs about $2.1 to make and reaches 60–100 non-followers on Instagram; a carousel reaches 1–3. The rendered master (`reel_renders`, 1080×1920 H.264 + AAC, ≤ 30 s, no platform watermark) is a valid Short as it is. Uploading the same file to YouTube adds a second audience for the cost of one API call.

## Scope

- **One market, one channel:** the English market (`YOUTUBE_MARKET=en`) to one YouTube channel the owner controls (`YOUTUBE_CHANNEL_ID`). Spanish is a second channel later (same code, a second set of variables or a table; not now).
- **Follows Instagram:** a Reel goes to YouTube only after its Instagram publication is `PUBLISHED`. Instagram stays the place where content is approved, scheduled and safeguarded; this feature reads the approved snapshot that Instagram published and changes nothing in the Instagram path.
- **Not in scope:** YouTube analytics (later, `youtubeAnalytics` API), comments, playlists, Spanish channel, a button in the UI (the CLI and the cron are enough for one channel).

## API (verified against the official reference 2026-10-17, V-31)

- `videos.insert` with the **resumable upload protocol**: `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with the `video` resource as JSON and `X-Upload-Content-Length` / `X-Upload-Content-Type` → `200` with the session URI in `Location`; then `PUT <session>` with the bytes → `201` with the video. An interrupted upload is checked with an empty `PUT` and `Content-Range: bytes */<size>` (`308` + `Range` = resume from there; the finished answer = done; `404` = the session expired).
- Quota: 100 uploads per day, 1 unit each in the "Video Uploads" bucket; `channels.list` and `videos.list` cost 1 unit of the normal 10,000. We upload at most one Short per hour.
- The reference says videos from unverified API projects are **not** restricted to private viewing any more (older guides said they were); an upload may still default to private by the channel's own settings.
- Scope: `https://www.googleapis.com/auth/youtube.upload` for the upload, plus `youtube.readonly` to check the channel (`channels.list?mine=true`) and to read the video's processing state. OAuth for one channel with an offline **refresh token**; access tokens come from `https://oauth2.googleapis.com/token` and are never stored.
- Limits enforced before the call: title 1–100 characters, description ≤ 5,000 bytes, neither may contain `<` or `>`; tags ≤ 500 characters in all.
- `status.containsSyntheticMedia` discloses realistic altered or synthetic content; `status.selfDeclaredMadeForKids` is required for COPPA.

## What is sent

| Field | Value |
|---|---|
| `snippet.title` | The Reel's hook line: the first paragraph of the approved caption (G-01 writes it from the chosen hook's two cards), whitespace folded, `<`/`>` removed, cut at a word to ≤ 100 characters. Fallback: the snapshot's `hook`. |
| `snippet.description` | The rest of the approved caption **without the Instagram ask**: the CTA sentence (`cta.text`, the caption's last sentence by G-01's rule) is removed, and so is any sentence that only works on Instagram (link in bio, DM, "comment WORD", save/send/share this, follow, Instagram). Then the AI note of the market (if the snapshot has one), then the Reel's hashtags and `#Shorts` in one line. |
| `snippet.tags` | The Reel's hashtags without `#` (not shown to viewers; search hint). |
| `snippet.categoryId` | `26` (Howto & Style). |
| `snippet.defaultLanguage`, `defaultAudioLanguage` | The market's language (`en`). |
| `status.privacyStatus` | Setting `youtube.privacy_status` (`private` when missing, so the first live upload is private; the owner sets `public` after checking it). |
| `status.selfDeclaredMadeForKids` | `false`. |
| `status.containsSyntheticMedia` | `true`: every shot is AI-animated from our pictures, which is realistic synthetic content in YouTube's sense. (Owner can overrule; it is one constant.) |
| media | The approved mp4 itself (`snapshot.reel.videoKey`), read from R2 and checked against the approved SHA-256 before it is sent. |

**No brand text:** the accounts are independent. Title, description and tags are checked for the source brand's name before every upload; a hit stops the upload (`GUARD_BRAND_TEXT`). The text comes from the approved Instagram caption, which already follows that rule.

## Data model (migration `0014_youtube_shorts`)

`youtube_uploads`: one row per attempt to put one approved Reel on YouTube.

- `content_variant_id`, `content_variant_version_id` (the approved snapshot), `publication_id` (the Instagram publication it follows), `market_id`.
- `status` (`QUEUED`, `IN_PROGRESS`, `PUBLISHED`, `DRY_RUN_PASSED`, `FAILED`), `step` (`GUARDS`, `UPLOAD`, `FINALIZE`), `dry_run`, `attempt_count`, `trigger_run_id`.
- `metadata` (what was or would be sent), `channel_id`.
- `upload_session_encrypted` (the session URI, encrypted like tokens, D-18: it lets anyone who has it send bytes into our upload), `upload_started_at` (set right before the bytes are sent).
- `youtube_video_id` (unique), `url`, `upload_status`, `processing_status`, `published_at`, `last_error`.
- Unique: one live (not dry run) upload per variant among `QUEUED`, `IN_PROGRESS`, `PUBLISHED`. RLS on, no policies (04 §4.1).

## Flow (job J25 `sync-youtube-shorts`, hourly at :37, queue `youtube-publish`, concurrency 1)

1. **Pick:** if `YOUTUBE_PUBLISH_MODE` is `off` or `youtube.enabled` is not `true`, do nothing. Otherwise resume an `IN_PROGRESS` row, else take the oldest Instagram Reel publication of the market that is `PUBLISHED` in the last 30 days and has no upload of this kind yet (live mode: no live row in any status; `dry_run_only`: no dry-run row), and create its row. One Reel per run.
2. **GUARDS** (again right before the bytes go): mode and setting; the Instagram publication is `PUBLISHED`, not a dry run, a Reel of the configured market; its version holds a Reel snapshot; the stored file's SHA-256 and size equal the approved ones, 9:16, ≤ 180 s; the refresh token works and `channels.list?mine=true` is `YOUTUBE_CHANNEL_ID`; the metadata passes the limits and the brand check; no video id yet.
   - **Dry run** stops here: `DRY_RUN_PASSED`, with the metadata stored for the owner to read. Nothing is uploaded.
3. **UPLOAD:** start the resumable session (repeatable: a session without bytes creates nothing) and save it encrypted; set `upload_started_at`; `PUT` the bytes; `201` → save the video id.
4. **FINALIZE:** read `videos.list?part=status,processingDetails` a few times (up to ~5 min): `processed`/`uploaded` → `PUBLISHED` with the Shorts URL; `rejected`/`failed` → `FAILED` with the reason (the video id stays on the row). A video still processing is `PUBLISHED` too: it is on the channel.

### Idempotency: never two videos for one Reel

The resumable session is the idempotency key: one session URI produces at most one video. A run that dies or gets no answer after the bytes went out resumes with the **same** session:

- Status `PUT` answers `201`/`200` → the upload finished; take the video id from it.
- `308` → resume from the `Range` the server reports (never re-send from 0 into a new session).
- `404` (expired) **and** `upload_started_at` set → look for our video among the channel's latest uploads by title and time; found → save its id; not found → `FAILED` "manual check required" with an integration event. Never start a second upload blindly (same rule as `media_publish`, 09 §9.4.3).
- `404` and no bytes sent → start a new session.

A `FAILED` live row is never retried by the cron. `pnpm rc youtube-shorts --retry <uploadId>` (owner, after looking at the channel) starts again.

### Errors

| Signal | Class | Action |
|---|---|---|
| network, 500/502/503/504 | TRANSIENT | retry with backoff (≤ 5 attempts), resume at the step |
| 403 `quotaExceeded`, `uploadLimitExceeded`, `rateLimitExceeded`; 429 | RATE_LIMIT | retry later (the next run) |
| token `invalid_grant`, 401 | AUTH | `FAILED`; integration event `YOUTUBE_REAUTH` on the Health page |
| 403 `forbidden`, `youtubeSignupRequired` | PERMISSION | `FAILED` |
| other 4xx (`invalidTitle`, `invalidDescription`, …) | PERMANENT | `FAILED` |

## Switches

- `YOUTUBE_PUBLISH_MODE` = `off` (default) | `dry_run_only` | `live`, with `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_CHANNEL_ID`, `YOUTUBE_MARKET` (default `en`) when not `off`.
- `app_settings.youtube.enabled` (missing = off): the owner's switch for the cron. A dry run from the CLI does not need it.
- `app_settings.youtube.privacy_status` (`private` | `unlisted` | `public`, missing = `private`).

## UI

The Published list gets a **YouTube Shorts** column: a link to the Short when its upload is `PUBLISHED`, else a dash. The CSV gets `youtube_url`.
