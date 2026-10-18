# YouTube Shorts: setup, dry run and the first live upload (G-09)

Design: `docs/design/youtube-shorts.md`. A Reel that Instagram has published is uploaded to one YouTube channel as a Short: the same approved mp4, the Reel's hook line as the title, its caption without the Instagram ask, `#Shorts`. **Everything is off by default.** Nothing is uploaded until all of these are true: `YOUTUBE_PUBLISH_MODE=live`, the setting `youtube.enabled` is `true`, and the owner has said yes to the first live upload.

The accounts are independent: use a channel that is not tied to the source brand (its name, handle and description too), and a Google account / Cloud project that you are fine with the public not connecting to it.

## What the owner has to do (once)

### 1. A YouTube channel for the English account
1. Create (or pick) the channel that should carry the Shorts. A **Brand Account** channel is the clean choice: it has its own name and can be managed without sharing your personal Google login.
2. Verify the channel by phone (YouTube Studio → Settings → Channel → Feature eligibility) so that uploads are not capped.
3. Copy the **channel id** (`UC…`, 24 characters): YouTube Studio → Settings → Channel → Advanced settings → Channel ID. This is `YOUTUBE_CHANNEL_ID`.

### 2. A Google Cloud project with the YouTube Data API
1. https://console.cloud.google.com → new project (any name that does not carry the source brand).
2. APIs & Services → Library → **YouTube Data API v3** → Enable.
3. APIs & Services → **OAuth consent screen**: user type **External**, app name, your e-mail, no logo needed. Scopes: add `.../auth/youtube.upload` and `.../auth/youtube.readonly`. Test users: the Google account that owns the channel.
4. **Publishing status.** In *Testing* Google expires refresh tokens after **7 days**, so the job would stop weekly. Press **Publish app** (status *In production*). The app stays unverified (a warning screen appears when you authorize: *Advanced → Go to … (unsafe)*; fine for your own account, limited to 100 users) and its refresh token does not expire. Verification by Google is not needed for one owner.
5. APIs & Services → Credentials → **Create credentials → OAuth client ID**, type **Web application**. Authorized redirect URI: `https://developers.google.com/oauthplayground`. Copy the **client id** (`YOUTUBE_CLIENT_ID`) and **client secret** (`YOUTUBE_CLIENT_SECRET`).

### 3. The refresh token (once, in a browser)
1. Open https://developers.google.com/oauthplayground → the gear icon → tick **Use your own OAuth credentials** → paste the client id and secret.
2. In *Step 1* enter these two scopes by hand and press **Authorize APIs**:
   `https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly`
3. Sign in as the channel's Google account, pick the **channel** (Brand Account) when asked, allow both permissions.
4. *Step 2* → **Exchange authorization code for tokens** → copy the **Refresh token**. This is `YOUTUBE_REFRESH_TOKEN`.
5. Never paste any of the three secrets into chat, git or an issue. They go into the environments below only. To revoke access later: https://myaccount.google.com/permissions.

### 4. Put the variables where the jobs run
Trigger.dev (the job `sync-youtube-shorts` runs there) and, for `pnpm rc youtube-shorts`, your local `.env`. Vercel does not need them.

| Variable | Value |
|---|---|
| `YOUTUBE_PUBLISH_MODE` | `dry_run_only` first, later `live` |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | from steps 2–3 |
| `YOUTUBE_CHANNEL_ID` | `UC…` from step 1 |
| `YOUTUBE_MARKET` | optional, `en` by default |

### 5. Apply the migration, then merge
`db/migrations/0014_youtube_shorts.sql` adds the table `youtube_uploads`. The published list reads it, so **apply the migration before the new code runs** (the owner applies migrations; the repository never does):

```bash
pnpm db:migrate
```

Merging to `main` deploys Vercel and the Trigger.dev tasks by themselves (the new task `sync-youtube-shorts` appears on the Trigger.dev Deployments page, cron `37 * * * *`). With `YOUTUBE_PUBLISH_MODE` unset it does nothing.

## Dry run (uploads nothing)

With `YOUTUBE_PUBLISH_MODE=dry_run_only` (or `live`) and a published English Reel:

```bash
pnpm rc youtube-shorts --dry-run
```

It refreshes the token, checks that the token's channel is `YOUTUBE_CHANNEL_ID`, checks the stored video against the approved SHA-256, builds the title, description and tags, and prints them. Read them: the title should be the Reel's hook line, the description must have no "link in bio", "send this", "follow", Instagram or any brand name, and end with the hashtags and `#Shorts`. Nothing is uploaded. `--publication <id>` picks a specific Instagram publication.

Status at any time (no secrets in it):

```bash
pnpm rc youtube-shorts
```

## First live upload (ask first)

The owner decides; Claude does not upload without a yes.

1. Set `YOUTUBE_PUBLISH_MODE=live` in Trigger.dev (redeploy not needed; restart the env var, the next run reads it).
2. Leave `youtube.privacy_status` unset: the first Short is **private**.
3. Switch on and let the hourly job pick the oldest eligible Reel (or run the task by hand from the Trigger.dev dashboard):
   ```bash
   pnpm rc setting youtube.enabled true
   ```
4. Open the Short from `pnpm rc youtube-shorts` (or the Published list, column *YouTube Shorts*). Check in YouTube Studio: it is vertical and under 3 minutes (a Short), the title and description are as in the dry run, **Altered content: yes** (the shots are AI-animated), **not made for kids**, and **the video is not locked to private by YouTube** (see V-31 below).
5. If it is right, make it public and keep new ones public:
   ```bash
   pnpm rc setting youtube.privacy_status public
   ```
   (existing private Shorts are changed by hand in Studio).

Stop at any time: `pnpm rc setting youtube.enabled false` (the job then does nothing) or `YOUTUBE_PUBLISH_MODE=off`.

## When something goes wrong

| Status / event | Meaning | What to do |
|---|---|---|
| `FAILED`, `GUARD_*` | a safeguard did not hold (wrong market or channel, the stored video is not the approved one, text names the source brand, …) | read `lastError` in `pnpm rc youtube-shorts`; fix the cause |
| Health page: `YOUTUBE_REAUTH` | Google refuses the refresh token (revoked, expired, app in *Testing*) | repeat step 3, update `YOUTUBE_REFRESH_TOKEN`, then `pnpm rc youtube-shorts --retry <uploadId>` |
| Health page: `YOUTUBE_MANUAL_CHECK` | the upload may have reached YouTube but could not be confirmed | look at the channel in Studio; if the Short is there, nothing to do (mark nothing, the next Reel continues); if not, `--retry <uploadId>` |
| `RATE_LIMIT` (`quotaExceeded`, `uploadLimitExceeded`) | the day's API quota (100 uploads, far above our use) or the channel's daily upload limit | nothing; the job retries on the next run |
| `FAILED` after `rejected` | YouTube refused the file (duplicate, copyright, …) | see the reason; the job does not try this Reel again |

A `FAILED` live upload is never retried by the cron. `pnpm rc youtube-shorts --retry <uploadId>` starts a new attempt for the same Reel after you looked.

## Open verification (V-31)

Checked 2026-10-17 against the official `videos.insert` reference: quota (1 unit in the "Video Uploads" bucket, 100 calls a day), resumable protocol, field limits, `containsSyntheticMedia`. Older guides say that API projects created after 2020-07-28 that have not passed Google's audit can only upload **private** videos; the current reference says the opposite. **Open until the first live upload:** if Studio shows the Short as locked private ("your video was locked as private … API project not verified"), apply for the audit: https://support.google.com/youtube/contact/yt_api_form . Until then Shorts stay private and are published by hand in Studio.
