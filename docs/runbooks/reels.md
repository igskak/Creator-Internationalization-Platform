# Reels: review, dry run and the first live Reel (M8-09, plan 18 §18.5)

A Reel goes through the same steps as a carousel: review → approve → dry run → schedule or publish now. What differs is the media (one mp4 instead of slides) and Gate **G3**: no live Reel before the owner's decision in `docs/decisions/G3.md`.

## Before the first deploy of M8-09

1. **Apply migration `0010_reel_versions.sql` first, then merge.** The code reads the new column `content_variant_versions.reel_render_id` on every approved version (carousels too): code without the column breaks publishing.
   ```bash
   pnpm db:migrate
   ```
2. Merge to `main`. Vercel and Trigger.dev prod deploy by themselves (check the Trigger.dev Deployments page for the new version).

## 1. Review a Reel

On `/content/review/<ideaId>`, in the market's column, the Reel card (under the carousel) shows the video and, under it, **Review and publish**:

- **Approve** (checklist: facts checked). Allowed when the video shows the newest script (not while a new hook or a redone shot is being built). The approval freezes this exact file: its storage key and SHA-256, the caption, hashtags, call to action and the AI disclosure. The Reel can no longer be changed; **Withdraw the approval** to change it.
- **Request changes**, **Reject** (with a reason). A rejected Reel frees the slot: a new Reel can be generated for the post.
- Reels appear in **Drafts** (with a Reel badge), in the work-queue counters and in the calendar's "approved, not scheduled" list.

## 2. Dry run (posts nothing)

Needs `INSTAGRAM_PUBLISH_MODE` `dry_run_only` or `live`, the market's account ACTIVE and in `INSTAGRAM_ACCOUNT_ALLOWLIST`.

On an approved Reel press **Dry run** in its publishing panel. The publisher checks the file (size, length 3 s–15 min, 9:16, SHA-256 = approved), creates a `REELS` container with a fresh presigned link to the mp4 (2 h), and polls until `FINISHED` (up to 15 minutes; Meta downloads and transcodes the video). Nothing is published; the container expires in 24 h. If Meta cannot fetch the video (error 2207052 / 2207003 in the status), the container is made once more with a new link, then the run fails.

The same check without the app (a synthetic 6 s clip made by ffmpeg, or your own file):

```bash
pnpm ig:smoke --account <user name> --reel
```

```bash
pnpm ig:smoke --account <user name> --reel --video reel.mp4
```

The report's finding **V-26** says whether Meta downloaded the video from the presigned R2 link. If it did not, set `RENDERS_PUBLIC_BASE_URL` (plan 09 §9.3) and run again.

Then:

```bash
pnpm rc g3-check
```

## 3. Gate G3 and the first live Reel

1. `pnpm rc g3-check` shows item 2 (a Reel dry run passed) and item 3 (an approved Reel waits) as PASS, and item 4 lists no live Reel.
2. The owner watches the approved Reel once more and records the decision in `docs/decisions/G3.md` (GO / NO-GO, date, which Reel, which account).
3. Only after GO: the environment must be `INSTAGRAM_PUBLISH_MODE=live` with publishing switched on. Press **Publish now** (or **Schedule…**) on the Reel's card. The publisher repeats the checks right before `media_publish` and never repeats `media_publish` blindly.
4. Open the permalink, check the Reel plays with sound, the caption and the AI label or note. Write media id and permalink into `docs/decisions/G3.md`.

## What Instagram accepts (V-25, checked 2026-10-15)

`media_type=REELS`, `video_url` on a public HTTPS server (Meta fetches it with cURL; US-ASCII only), MOV or MP4 with the moov atom first, H.264 or HEVC, 4:2:0, closed GOP, AAC up to 48 kHz, 23–60 fps, at most 1920 px wide, 3 s to 15 min, at most 300 MB, VBR up to 25 Mbps; 9:16 recommended. `share_to_feed` true shows it on the grid too. A container lives 24 h. Our renderer makes 1080 × 1920, 30 fps, H.264 High yuv420p, AAC, faststart, 12–30 s. Reels count toward the 24-hour publishing limit (read `content_publishing_limit`).
