# Instagram public profile backup

A local command-line tool for macOS (also works on Linux) that makes a complete,
resumable backup of the **publicly visible** content of an Instagram profile,
using [Instaloader](https://instaloader.github.io/).

It saves:

- photo posts, video posts and Reels (if the Reels tab is publicly visible)
- every photo and video in carousel posts
- the profile picture (older versions are kept if it changes)
- post metadata: shortcode, Instagram URL, UTC date/time, caption, media type,
  likes, comments, hashtags, mentions, tagged users, local file names
- `posts.json` and `posts.csv` with all metadata
- `index.html`, an offline gallery you can open in any browser

The tool only reads what anyone can see on the public profile page. It does not
bypass logins, CAPTCHAs or rate limits, and does not use proxies or parallel
downloads.

---

## 1. Install

You need Python 3.9 or newer. macOS already has `python3` once the Xcode
Command Line Tools are installed (`xcode-select --install`). Check with:

```bash
python3 --version
```

Then, in this folder:

```bash
cd instagram-backup
python3 -m venv .venv            # create an isolated environment (once)
source .venv/bin/activate        # activate it (in every new Terminal window)
python3 -m pip install -r requirements.txt
```

Check that it works:

```bash
python3 backup_instagram.py --help
```

## 2. Run a backup

```bash
python3 backup_instagram.py some_username
```

You can also paste the profile URL or `@some_username`.

A full backup of a large profile can take a long time (hours for 1000+ posts),
because the tool waits between requests on purpose. On a Mac, keep the laptop
awake while it runs:

```bash
caffeinate -i python3 backup_instagram.py some_username
```

### Useful options

| Option | What it does |
| --- | --- |
| `--output PATH` | Base folder for backups. Default: `./backup`. The profile goes to `PATH/USERNAME/`. |
| `--reels` / `--no-reels` | Also scan the Reels tab (default: on). Reels that appear in the main grid are always saved as posts. |
| `--html` / `--no-html` | Create `index.html` (default: on). |
| `--metadata-only` | Save captions and other metadata, but download no photos/videos. A later normal run downloads the media. |
| `--since YYYY-MM-DD` | Only posts published on or after this date (UTC). |
| `--until YYYY-MM-DD` | Only posts published on or before this date (UTC). |
| `--verify` | Check an existing backup offline and report problems (see below). |
| `--delay SECONDS` | Extra pause between posts (default: 1). Increase it if you get rate-limited often. |
| `--max-retries N` | Attempts per request for temporary errors (default: 5). |
| `--login YOUR_USERNAME` | Optional fallback, see [Login](#login-optional-fallback). |

Examples:

```bash
python3 backup_instagram.py some_username --output ~/Documents/instagram-backups
python3 backup_instagram.py some_username --no-reels --since 2022-01-01
python3 backup_instagram.py some_username --metadata-only
```

## 3. Where the backup is stored

```
backup/
  some_username/
    index.html      offline gallery — double-click to open in your browser
    posts.json      all post metadata (UTF-8 JSON)
    posts.csv       the same as a spreadsheet (opens in Numbers / Excel)
    README.txt      what each file is + summary of the last run
    errors.log      warnings and errors from all runs (with UTC timestamps)
    media/          photos and videos
    metadata/
      profile.json  profile snapshot (bio, name, counts, …)
      posts/        one JSON record per post — the source of truth
      raw/          original Instaloader data per post (.json.xz)
      state.json    scan progress
```

Media file names are deterministic and sort by date:

```
2023-05-01_12-34-56_CxAbC123dEf_01.jpg     single photo, or item 1 of a carousel
2023-05-01_12-34-56_CxAbC123dEf_02.mp4     item 2 of the carousel (a video)
2023-05-01_12-34-56_CxAbC123dEf_02_cover.jpg   preview image of that video
profile_pic_2026-09-27.jpg
```

The time in the name is the publication time in **UTC**. The file's
"modified" date is also set to the publication time, so Finder can sort by it.

In `posts.csv`, list fields (hashtags, mentions, tagged users, media files) are
separated with `;`.

## 4. Resume an interrupted backup

Just run **the exact same command again**. This works after:

- pressing Ctrl+C
- a crash, power loss or closed laptop
- lost Internet connection
- Instagram rate limiting ("429 Too Many Requests" / "Please wait a few minutes")

How it works:

- Every file is written to a `.part` file first and renamed only when complete,
  so a half-downloaded file is never mistaken for a good one.
- Each post is recorded in `metadata/posts/` as soon as it is done.
  Posts that are already complete are skipped without downloading anything.
- The position in the post list is saved when a run stops early
  (`metadata/resume_*.json.xz`), so the next run continues from there.
- Posts that failed are retried automatically on the next run.
- Existing valid files are never overwritten, and complete posts are never
  processed again. If a post is processed again (for example to repair a
  missing file) and its caption was edited on Instagram in the meantime, the
  originally archived caption is kept and the new one is stored as
  `caption_latest`. A changed profile bio/name is kept as
  `metadata/profile_<date>.json`.
- Posts deleted from Instagram stay in the backup.

Temporary errors are retried with exponential backoff (15 s, 30 s, 60 s, …; for
rate limits 2 min, 4 min, 8 min, …). If Instagram keeps refusing, the tool stops
cleanly, keeps everything, and tells you to re-run later. Waiting 30–60 minutes
(sometimes a few hours) usually helps. Do not run two backups at the same time —
the tool refuses to start a second run on the same folder.

## 5. Verify a backup

```bash
python3 backup_instagram.py some_username --verify
```

This works offline and reports:

- posts with missing media (failed or incomplete posts)
- metadata records that point to files that do not exist
- duplicated shortcode records (in `metadata/posts/`, `posts.json`, `posts.csv`)
- zero-byte or corrupted media (truncated JPEG/PNG/WebP/MP4, or files that
  are not images/videos at all, for example a saved error page)
- differences between `posts.json`/`posts.csv` and the post records
- leftover `.part` files and media files that no record uses (info only)

Exit code `0` means no problems. To repair missing or corrupted media, run the
normal backup command again: it re-downloads only what is missing or broken
(as long as the post is still on Instagram).

## 6. Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Finished, no failed posts |
| 1 | Finished, but some posts failed (see `errors.log`; re-run to retry) |
| 2 | Wrong usage or configuration |
| 3 | Profile not found, or profile is private |
| 4 | Stopped early (rate limit, login wall, network down). Re-run later to continue. |
| 5 | Another backup of the same profile is already running |
| 130 | Stopped with Ctrl+C. Re-run to continue. |

## 7. Run the tests

```bash
python3 -m unittest discover -s tests -v
```

The tests use real Instaloader objects with fake Instagram data and a fake
downloader, so they need no network access.

## Login (optional fallback)

The tool works **without login** by default, which is the right choice for a
public profile. If Instagram blocks anonymous access for a long time, you can
use a saved Instaloader session of **your own** account (never someone else's):

```bash
instaloader --login YOUR_USERNAME      # Instaloader asks for the password/2FA and saves a session
python3 backup_instagram.py some_username --login YOUR_USERNAME
```

This tool never asks for or stores passwords. Be aware that Instagram may
temporarily restrict accounts that download a lot; a logged-in run changes the
saved scan position, so the post list is scanned again from the start (already
downloaded posts are still skipped).

## Known limitations (Instaloader / Instagram)

- **Instagram changes often.** When downloads suddenly fail for everyone, update
  Instaloader: `python3 -m pip install -U instaloader`. Check
  <https://github.com/instaloader/instaloader/issues> for known problems.
- **Rate limits.** Instagram limits anonymous requests per IP address. Large
  profiles may need several runs over a day. The tool is slow on purpose.
- **Login walls.** Instagram sometimes redirects anonymous visitors to the login
  page, especially after many requests. Wait and retry, or see the login section.
- **Reels tab.** Anonymous access to the Reels tab may be blocked. The tool
  then prints a warning and continues. Most Reels also appear in the main grid
  and are saved as posts. Each Reel from the Reels tab needs one extra request,
  even if it is already saved; later runs stop scanning the Reels tab once they
  reach Reels saved in an earlier complete scan.
- **Like counts.** If the owner hid like counts, Instagram may report `0`.
  Like and comment counts are a snapshot from the time of the backup.
- **Media quality.** The tool saves the versions Instagram shows to anonymous
  visitors. These can have a lower resolution than the original upload. The
  profile picture is limited to Instagram's public size.
- **Not included:** Stories, Highlights, comments text, and posts where the
  profile is only tagged. Stories and Highlights always need a login and are
  out of scope for this tool.
- **Media links expire.** Instagram media URLs are signed and expire after some
  time. The tool reloads a post automatically when its links have expired.
- **Pinned posts** appear first in the list. `--since` allows for up to 3 pinned
  posts before it stops scanning.
- **Instagram's terms of use** restrict automated collection. Use this tool only
  for personal preservation of content you have the right to keep, at a
  conservative pace.
