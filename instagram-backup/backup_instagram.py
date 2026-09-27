#!/usr/bin/env python3
"""Back up the publicly visible content of a public Instagram profile.

Usage:
    python3 backup_instagram.py USERNAME [options]
    python3 backup_instagram.py USERNAME --verify

Re-running the same command resumes an interrupted backup. See README.md.
"""

from __future__ import annotations

import argparse
import csv
import errno
import glob
import hashlib
import io
import json
import logging
import os
import random
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

try:
    import instaloader
    import requests
    import urllib3
    from instaloader.exceptions import (
        AbortDownloadException,
        BadResponseException,
        ConnectionException,
        LoginRequiredException,
        PostChangedException,
        PrivateProfileNotFollowedException,
        ProfileNotExistsException,
        QueryReturnedBadRequestException,
        QueryReturnedForbiddenException,
        QueryReturnedNotFoundException,
        TooManyRequestsException,
    )
except ImportError as _import_error:  # pragma: no cover - depends on the environment
    sys.stderr.write(
        f"Missing Python package: {_import_error.name}\n"
        "Install the dependencies first:  python3 -m pip install -r requirements.txt\n"
    )
    sys.exit(2)

TOOL_VERSION = "1.0.0"

# Instagram shows up to 3 pinned posts first, out of date order.
PINNED_ALLOWANCE = 3
# On later runs, stop scanning the Reels tab after this many already-archived reels in a row.
KNOWN_REELS_STOP = PINNED_ALLOWANCE + 2
# Stop the run when this many posts in a row fail (network is probably down).
CONSECUTIVE_FAILURE_LIMIT = 5

BACKOFF_BASE_SECONDS = 15.0
BACKOFF_RATE_LIMIT_SECONDS = 120.0
BACKOFF_MAX_SECONDS = 20 * 60.0
REQUEST_TIMEOUT_SECONDS = 60.0
CHUNK_SIZE = 256 * 1024

USERNAME_RE = re.compile(r"[a-z0-9._]{1,30}")
# Same pattern Instaloader uses for Post.caption_hashtags, applied to the original
# caption so the hashtag's original capitalization is kept.
HASHTAG_RE = re.compile(r"#(\w{1,150})")

CONTENT_TYPE_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
}
MEDIA_EXTS = set(CONTENT_TYPE_EXT.values()) | {".jpeg"}

# Fields that are kept from the first successful archive of a post. The account was
# compromised, so later edits on Instagram must not replace the original data.
PRESERVED_FIELDS = (
    "date_utc", "timestamp", "caption", "hashtags", "mentions", "tagged_users",
    "likes", "comments", "first_archived_utc",
)

CSV_COLUMNS = [
    "shortcode", "url", "date_utc", "media_type", "caption", "likes", "comments",
    "hashtags", "mentions", "tagged_users", "media_count", "media_files", "status",
    "error", "sources", "first_archived_utc",
]

RATE_LIMIT_ADVICE = (
    "Instagram is rate-limiting requests from this network. Everything downloaded so far "
    "is saved. Wait at least 30-60 minutes (sometimes a few hours), then re-run the same "
    "command to continue."
)
LOGIN_WALL_ADVICE = (
    "Instagram asked for a login (anonymous access is blocked right now). Everything "
    "downloaded so far is saved. Wait a few hours and re-run the same command. If this "
    "keeps happening, see the 'Login' section in README.md."
)

EXIT_OK = 0
EXIT_SOME_FAILED = 1
EXIT_USAGE = 2
EXIT_PROFILE = 3
EXIT_STOPPED = 4
EXIT_LOCKED = 5
EXIT_INTERRUPTED = 130

log = logging.getLogger("instagram_backup")


# --------------------------------------------------------------------------- errors


class FatalStop(Exception):
    """Stops the whole run early. Everything archived so far is kept."""


class IncompleteDownload(Exception):
    """A transfer ended early or returned unusable data. Worth retrying."""


class MediaUnavailable(Exception):
    """Instagram returned a post without a usable media URL."""


class ListingUnavailable(FatalStop):
    """A post list (grid or Reels tab) could not be loaded from Instagram."""


class LockHeld(Exception):
    """Another backup run uses the same folder."""


TRANSIENT_ERRORS = (
    ConnectionException,
    requests.exceptions.RequestException,
    urllib3.exceptions.HTTPError,
    json.JSONDecodeError,
    IncompleteDownload,
    PostChangedException,
)
# Checked before TRANSIENT_ERRORS: QueryReturnedNotFoundException is a ConnectionException.
PERMANENT_ERRORS = (
    QueryReturnedNotFoundException,
    QueryReturnedForbiddenException,
    QueryReturnedBadRequestException,
    ProfileNotExistsException,
    PrivateProfileNotFollowedException,
    LoginRequiredException,
)

_RATE_LIMIT_HINTS = ("429", "too many requests", "wait a few minutes", "401 unauthorized", "rate limit")


def is_rate_limited(err: BaseException) -> bool:
    if isinstance(err, TooManyRequestsException):
        return True
    text = str(err).lower()
    return any(hint in text for hint in _RATE_LIMIT_HINTS)


def one_line(err: BaseException, limit: int = 300) -> str:
    text = " ".join(str(err).split()) or type(err).__name__
    return text if len(text) <= limit else text[: limit - 1] + "…"


def fmt_duration(seconds: float) -> str:
    seconds = int(round(seconds))
    if seconds < 90:
        return f"{seconds} s"
    minutes = seconds // 60
    if minutes < 90:
        return f"{minutes} min"
    return f"{minutes // 60} h {minutes % 60} min"


def human_size(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024 or unit == "GB":
            return f"{num:.0f} {unit}" if unit == "B" else f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} GB"


class Retrier:
    """Runs a callable and retries temporary network / rate-limit errors with exponential backoff."""

    def __init__(self, max_attempts: int = 5, sleep: Callable[[float], None] = time.sleep,
                 interrupted: Callable[[], bool] = lambda: False):
        self.max_attempts = max(1, max_attempts)
        self.sleep = sleep
        self.interrupted = interrupted

    def call(self, fn: Callable[[], Any], what: str) -> Any:
        attempt = 1
        while True:
            try:
                return fn()
            except PERMANENT_ERRORS:
                raise
            except TRANSIENT_ERRORS as err:
                if self.interrupted():
                    raise KeyboardInterrupt from err
                if attempt >= self.max_attempts:
                    raise
                limited = is_rate_limited(err)
                base = BACKOFF_RATE_LIMIT_SECONDS if limited else BACKOFF_BASE_SECONDS
                delay = min(BACKOFF_MAX_SECONDS, base * 2 ** (attempt - 1)) * random.uniform(0.85, 1.15)
                log.warning("%s failed (attempt %d/%d): %s", what, attempt, self.max_attempts, one_line(err))
                reason = "Instagram is rate limiting requests" if limited else "Temporary problem"
                log.info("    %s — waiting %s before retrying…", reason, fmt_duration(delay))
                self.sleep(delay)
                attempt += 1


# --------------------------------------------------------------------------- helpers


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso_utc(value: Any) -> Optional[datetime]:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def post_date_utc(post: Any) -> datetime:
    # Post.date_utc is a naive datetime in UTC.
    return post.date_utc.replace(tzinfo=timezone.utc)


def media_basename(dt: datetime, shortcode: str) -> str:
    return f"{dt:%Y-%m-%d_%H-%M-%S}_{shortcode}"


def normalize_username(raw: str) -> str:
    """Accepts 'name', '@name' or a profile URL and returns the lowercase username."""
    value = raw.strip()
    match = re.match(r"^(?:https?://)?(?:www\.|m\.)?instagram\.com/([^/?#]+)", value, re.IGNORECASE)
    if match:
        value = match.group(1)
    value = value.strip("/").lstrip("@").lower()
    if not USERNAME_RE.fullmatch(value):
        raise ValueError(f"{raw!r} is not a valid Instagram username")
    return value


def extract_hashtags(caption: str) -> List[str]:
    seen: Set[str] = set()
    tags = []
    for tag in HASHTAG_RE.findall(caption or ""):
        if tag.lower() not in seen:
            seen.add(tag.lower())
            tags.append(tag)
    return tags


def optional_value(fn: Callable[[], Any], default: Any = None) -> Any:
    """Reads a post/profile field that Instagram does not always provide."""
    try:
        return fn()
    except (KeyError, TypeError, AttributeError, ValueError, IndexError, BadResponseException):
        return default


def ext_from_content_type(content_type: Optional[str]) -> Optional[str]:
    if not content_type:
        return None
    return CONTENT_TYPE_EXT.get(content_type.split(";")[0].strip().lower())


def ext_from_url(url: str) -> Optional[str]:
    suffix = os.path.splitext(urlparse(url).path)[1].lower()
    if suffix == ".jpeg":
        return ".jpg"
    return suffix if suffix in MEDIA_EXTS else None


def atomic_write_text(path: Path, text: str, encoding: str = "utf-8") -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding=encoding, newline="") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def atomic_write_json(path: Path, data: Any) -> None:
    atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def read_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------- media checks


def sniff_format(head: bytes) -> Optional[str]:
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if head[4:8] == b"ftyp":
        return "isobmff"  # MP4 / MOV / HEIC
    return None


def _check_isobmff(fh: Any, size: int, brand: bytes) -> Optional[str]:
    """Walks the top-level boxes of an MP4/MOV/HEIC file to detect truncation."""
    pos = 0
    seen = set()
    while pos < size:
        fh.seek(pos)
        header = fh.read(8)
        if len(header) < 8:
            return "truncated video (incomplete data at the end of the file)"
        box_size = int.from_bytes(header[:4], "big")
        box_type = header[4:8]
        if box_size == 1:
            large = fh.read(8)
            if len(large) < 8:
                return "truncated video (incomplete data at the end of the file)"
            box_size = int.from_bytes(large, "big")
            if box_size < 16:
                return "corrupted video (invalid structure)"
        elif box_size == 0:  # box extends to the end of the file
            seen.add(box_type)
            pos = size
            break
        elif box_size < 8:
            return "corrupted video (invalid structure)"
        seen.add(box_type)
        pos += box_size
    if pos > size:
        return "truncated video (file is shorter than its internal structure says)"
    still_image = brand in (b"heic", b"heix", b"mif1", b"msf1", b"avif")
    if not still_image and b"moov" not in seen:
        return "incomplete video (no 'moov' index)"
    return None


def media_problem(path: Path, suffix: Optional[str] = None) -> Optional[str]:
    """Returns a description of what is wrong with a media file, or None if it looks valid.

    `suffix` overrides the file's extension (used to check `.part` files before renaming).
    """
    try:
        size = path.stat().st_size
    except OSError as err:
        return f"cannot read file ({err.strerror or err})"
    if size == 0:
        return "zero-byte file"
    suffix = (suffix or path.suffix).lower()
    try:
        with open(path, "rb") as fh:
            head = fh.read(16)
            kind = sniff_format(head)
            if kind is None:
                if suffix in MEDIA_EXTS:
                    return "unrecognized content (not an image/video — possibly an error page or corrupted data)"
                return None
            if kind == "jpeg":
                fh.seek(max(0, size - 1024))
                return None if b"\xff\xd9" in fh.read() else "truncated JPEG (end-of-image marker missing)"
            if kind == "png":
                fh.seek(max(0, size - 64))
                return None if b"IEND" in fh.read() else "truncated PNG"
            if kind == "webp":
                declared = int.from_bytes(head[4:8], "little") + 8
                return None if declared <= size else "truncated WebP"
            if kind == "isobmff":
                return _check_isobmff(fh, size, head[8:12])
            return None
    except OSError as err:
        return f"cannot read file ({err.strerror or err})"


# --------------------------------------------------------------------------- data model


@dataclass
class MediaItem:
    index: int  # 1-based position inside the post
    kind: str  # "image" or "video"
    url: str
    cover_url: Optional[str] = None  # preview image of a video


def plan_media(post: Any) -> List[MediaItem]:
    """Lists the media of a post. May need one request for full post metadata."""
    typename = post.typename
    if typename == "GraphSidecar":
        items = []
        for index, node in enumerate(post.get_sidecar_nodes(), start=1):
            if node.is_video:
                if not node.video_url:
                    raise MediaUnavailable(f"carousel item {index} is a video, but Instagram returned no video URL")
                items.append(MediaItem(index, "video", node.video_url, node.display_url or None))
            else:
                items.append(MediaItem(index, "image", node.display_url))
        if not items:
            raise MediaUnavailable("carousel without items")
        return items
    if typename == "GraphVideo":
        video_url = post.video_url
        if not video_url:
            raise MediaUnavailable("Instagram returned no video URL")
        return [MediaItem(1, "video", video_url, optional_value(lambda: post.url))]
    if typename == "GraphImage":
        return [MediaItem(1, "image", post.url)]
    raise MediaUnavailable(f"unsupported post type {typename!r}")


def classify_media_type(typename: Optional[str], product_type: Optional[str], source: str) -> str:
    if typename == "GraphSidecar":
        return "carousel"
    if typename == "GraphVideo":
        return "reel" if product_type == "clips" or source == "reels" else "video"
    if typename == "GraphImage":
        return "image"
    return str(typename or "unknown").lower()


def raw_node(post: Any) -> Dict[str, Any]:
    """The post's data as returned by Instagram, via Instaloader's public JSON export."""
    try:
        node = instaloader.get_json_structure(post)["node"]
        return node if isinstance(node, dict) else {}
    except Exception:  # noqa: BLE001 - purely optional information
        return {}


def record_files(rec: Dict[str, Any]) -> List[str]:
    """Local file names of all downloaded media of a record (including video covers)."""
    files = []
    for entry in rec.get("media") or []:
        if entry.get("downloaded") and entry.get("file"):
            files.append(entry["file"])
        if entry.get("cover"):
            files.append(entry["cover"])
    return files


def read_record_files(records_dir: Path) -> List[Tuple[Path, Optional[Dict[str, Any]], Optional[str]]]:
    """Reads metadata/posts/*.json. Returns (path, record or None, error or None)."""
    results = []
    if not records_dir.is_dir():
        return results
    for path in sorted(records_dir.glob("*.json")):
        try:
            rec = read_json(path)
            if not isinstance(rec, dict) or not rec.get("shortcode"):
                raise ValueError("no shortcode in record")
            results.append((path, rec, None))
        except (OSError, ValueError) as err:
            results.append((path, None, one_line(err)))
    return results


def sort_key(rec: Dict[str, Any]) -> Tuple[int, str]:
    return (rec.get("timestamp") or 0, rec.get("shortcode") or "")


class BackupPaths:
    def __init__(self, root: Path):
        self.root = root
        self.media = root / "media"
        self.metadata = root / "metadata"
        self.records = self.metadata / "posts"
        self.raw = self.metadata / "raw"
        self.errors_log = root / "errors.log"
        self.posts_json = root / "posts.json"
        self.posts_csv = root / "posts.csv"
        self.readme = root / "README.txt"
        self.index_html = root / "index.html"
        self.profile_json = self.metadata / "profile.json"
        self.state_json = self.metadata / "state.json"
        self.lock = self.metadata / "backup.lock"

    def create(self) -> None:
        for folder in (self.media, self.records, self.raw):
            folder.mkdir(parents=True, exist_ok=True)

    def resume_file(self, source: str, magic: str) -> Path:
        return self.metadata / f"resume_{source}_{magic}.json.xz"

    def latest_profile_pic(self) -> Optional[str]:
        pics = sorted(p.name for p in self.media.glob("profile_pic_*") if p.suffix.lower() in MEDIA_EXTS)
        return pics[-1] if pics else None


class RunLock:
    """Prevents two runs on the same backup folder (parallel runs cause rate limiting)."""

    def __init__(self, path: Path):
        self.path = path
        self.acquired = False

    def __enter__(self) -> "RunLock":
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                if self._holder_alive():
                    raise LockHeld(
                        f"Another backup run is using this folder (lock file {self.path}). "
                        "Wait for it to finish. If no other run is active, delete the lock file."
                    ) from None
                self.path.unlink(missing_ok=True)  # stale lock from a crashed run
                continue
            with os.fdopen(fd, "w") as fh:
                fh.write(str(os.getpid()))
            self.acquired = True
            return self
        raise LockHeld(f"Could not create lock file {self.path}")

    def _holder_alive(self) -> bool:
        try:
            pid = int(self.path.read_text().strip())
        except (OSError, ValueError):
            return False
        if pid == os.getpid():
            return False
        if os.name == "nt":  # os.kill(pid, 0) would terminate the process on Windows
            return True
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    def __exit__(self, *exc: Any) -> None:
        if self.acquired:
            self.path.unlink(missing_ok=True)


class InstaloaderFetcher:
    """Opens media URLs with Instaloader's anonymous download session (its headers and timeouts)."""

    def __init__(self, context: Any):
        self._context = context

    def open(self, url: str) -> Any:
        return self._context.get_raw(url)


@dataclass
class Options:
    reels: bool = True
    html: bool = True
    metadata_only: bool = False
    since: Optional[datetime] = None  # inclusive, UTC
    until: Optional[datetime] = None  # exclusive, UTC
    delay: float = 1.0
    max_attempts: int = 5


@dataclass
class RunStats:
    new_posts: int = 0
    skipped: int = 0
    failed: int = 0
    out_of_range: int = 0
    images: int = 0
    videos: int = 0
    covers: int = 0
    bytes: int = 0
    stopped_reason: Optional[str] = None
    failed_shortcodes: List[str] = field(default_factory=list)


# --------------------------------------------------------------------------- archiver


class Archiver:
    """Archives posts into a backup folder. Safe to interrupt and re-run at any point."""

    def __init__(self, username: str, paths: BackupPaths, context: Any, options: Options,
                 fetcher: Any = None, sleep: Callable[[float], None] = time.sleep,
                 post_loader: Optional[Callable[[str], Any]] = None):
        self.username = username
        self.paths = paths
        self.context = context
        self.opt = options
        self.fetcher = fetcher or InstaloaderFetcher(context)
        self.sleep = sleep
        self.load_post = post_loader or (lambda sc: instaloader.Post.from_shortcode(context, sc))
        self.interrupted = False
        self.retrier = Retrier(options.max_attempts, sleep, lambda: self.interrupted)
        self.stats = RunStats()
        self.records: Dict[str, Dict[str, Any]] = {}
        self.record_paths: Dict[str, Path] = {}
        self.seen_this_run: Set[str] = set()
        self.consecutive_failures = 0
        self.profile_snapshot: Dict[str, Any] = {}
        self.state: Dict[str, Any] = {}
        paths.create()
        self._load_existing()

    # ---------------------------------------------------------------- state on disk

    def _load_existing(self) -> None:
        for path, rec, error in read_record_files(self.paths.records):
            if rec is None:
                log.warning("Unreadable metadata record %s (%s) — the post will be archived again.", path.name, error)
                continue
            shortcode = rec["shortcode"]
            current = self.records.get(shortcode)
            if current is None or (current.get("status") != "complete" and rec.get("status") == "complete"):
                self.records[shortcode] = rec
                self.record_paths[shortcode] = path
        if self.paths.profile_json.exists():
            try:
                self.profile_snapshot = read_json(self.paths.profile_json)
            except (OSError, ValueError):
                self.profile_snapshot = {}
        if self.paths.state_json.exists():
            try:
                self.state = read_json(self.paths.state_json)
            except (OSError, ValueError):
                self.state = {}

    def save_state(self, **changes: Any) -> None:
        self.state.update(changes)
        atomic_write_json(self.paths.state_json, self.state)

    def _save_record(self, rec: Dict[str, Any]) -> None:
        shortcode = rec["shortcode"]
        dt = parse_iso_utc(rec.get("date_utc"))
        name = (media_basename(dt, shortcode) if dt else f"undated_{shortcode}") + ".json"
        path = self.paths.records / name
        atomic_write_json(path, rec)
        old = self.record_paths.get(shortcode)
        if old is not None and old != path and old.exists():
            old.unlink()
        self.records[shortcode] = rec
        self.record_paths[shortcode] = path

    def is_done(self, rec: Dict[str, Any]) -> bool:
        status = rec.get("status")
        if status == "metadata_only":
            return self.opt.metadata_only
        if status != "complete":
            return False
        if self.opt.metadata_only:
            return True
        return all(media_problem(self.paths.media / name) is None for name in record_files(rec))

    def in_range(self, dt: Optional[datetime]) -> bool:
        if dt is None:
            return True
        if self.opt.since is not None and dt < self.opt.since:
            return False
        if self.opt.until is not None and dt >= self.opt.until:
            return False
        return True

    # ---------------------------------------------------------------- profile

    def save_profile(self, profile: Any) -> Dict[str, Any]:
        snapshot = {
            "username": optional_value(lambda: profile.username, self.username),
            "userid": optional_value(lambda: profile.userid),
            "full_name": optional_value(lambda: profile.full_name),
            "biography": optional_value(lambda: profile.biography),
            "external_url": optional_value(lambda: profile.external_url),
            "followers": optional_value(lambda: profile.followers),
            "followees": optional_value(lambda: profile.followees),
            "mediacount": optional_value(lambda: profile.mediacount),
            "is_private": optional_value(lambda: profile.is_private),
            "is_verified": optional_value(lambda: profile.is_verified),
            "is_business_account": optional_value(lambda: profile.is_business_account),
            "business_category_name": optional_value(lambda: profile.business_category_name),
            "captured_utc": iso_utc(utc_now()),
        }
        old = self.profile_snapshot
        watched = ("username", "full_name", "biography", "external_url")
        if old and any(old.get(key) != snapshot.get(key) for key in watched):
            stamp = str(old.get("captured_utc", "unknown")).replace(":", "-")
            history = self.paths.metadata / f"profile_{stamp}.json"
            if not history.exists():
                atomic_write_json(history, old)
            log.info("Profile name/bio/link changed since the last backup; the old version is kept in %s.",
                     history.name)
        atomic_write_json(self.paths.profile_json, snapshot)
        self.profile_snapshot = snapshot
        return snapshot

    def save_profile_pic(self, profile: Any) -> None:
        """Downloads the profile picture. A changed picture is saved next to the old ones."""
        incoming_stem = ".incoming_profile_pic"
        try:
            url = profile.profile_pic_url
            path, size = self.retrier.call(
                lambda: self._download(url, self.paths.metadata, incoming_stem, ".jpg"),
                "Download of the profile picture",
            )
        except (KeyboardInterrupt, FatalStop):
            raise
        except Exception as err:  # noqa: BLE001 - the profile picture is not critical
            if self.interrupted:
                raise KeyboardInterrupt from err
            log.warning("Could not download the profile picture: %s", one_line(err))
            return
        digest = file_sha256(path)
        for existing in self.paths.media.glob("profile_pic_*"):
            if existing.is_file() and file_sha256(existing) == digest:
                path.unlink()
                log.info("Profile picture: unchanged (%s).", existing.name)
                return
        base = f"profile_pic_{utc_now():%Y-%m-%d}"
        target = self.paths.media / f"{base}{path.suffix}"
        counter = 2
        while target.exists():
            target = self.paths.media / f"{base}_{counter}{path.suffix}"
            counter += 1
        os.replace(path, target)
        self.stats.bytes += size
        log.info("Profile picture saved: %s (%s)", target.name, human_size(size))

    # ---------------------------------------------------------------- listing passes

    def run_listing(self, iterator: Any, source: str, total: Optional[int]) -> None:
        """Walks a post list (profile grid or Reels tab), archiving each post.

        The position is saved automatically when the loop stops early, so the next run
        continues where this one stopped (Instaloader's resumable_iteration).
        """
        complete = False
        gaps = False
        known_streak = 0
        width = len(str(total)) if total else 1
        with instaloader.resumable_iteration(
            context=self.context,
            iterator=iterator,
            load=instaloader.load_structure_from_file,
            save=instaloader.save_structure_to_file,
            format_path=lambda magic: str(self.paths.resume_file(source, magic)),
        ) as (is_resuming, start_index):
            if is_resuming:
                log.info("Continuing the %s scan at item %d (saved position from an earlier run).",
                         source, start_index + 1)
            fast_stop = source == "reels" and bool(self.state.get("reels_scan_completed_utc")) and not is_resuming
            number = start_index
            while True:
                calls = [0]

                def fetch_next() -> Any:
                    calls[0] += 1
                    return next(iterator)

                try:
                    post = self.retrier.call(fetch_next, f"Loading the {source} list")
                except StopIteration:
                    complete = True
                    break
                except TRANSIENT_ERRORS as err:
                    if is_rate_limited(err):
                        raise FatalStop(RATE_LIMIT_ADVICE) from err
                    raise ListingUnavailable(f"Could not load the {source} list from Instagram: {one_line(err)}") from err
                if calls[0] > 1 and source == "reels":
                    gaps = True  # a reel that failed to load is skipped by the iterator
                number += 1
                label = f"[{number:>{width}}/{total}]" if total else f"[{number}/?]"
                shortcode = optional_value(lambda: post.shortcode, "?")
                posted = optional_value(lambda: post_date_utc(post))
                if self.opt.until is not None and posted is not None and posted >= self.opt.until:
                    self.stats.out_of_range += 1
                    log.info("%s Newer than --until — skipped: %s", label, shortcode)
                    continue
                if self.opt.since is not None and posted is not None and posted < self.opt.since:
                    if number <= PINNED_ALLOWANCE:
                        self.stats.out_of_range += 1
                        log.info("%s Older than --since (maybe pinned) — skipped: %s", label, shortcode)
                        continue
                    log.info("%s Reached posts older than --since — stopping the %s scan.", label, source)
                    break
                outcome = self.process(lambda: post, label, source, shortcode)
                known_streak = known_streak + 1 if outcome == "skipped" else 0
                if fast_stop and known_streak >= KNOWN_REELS_STOP:
                    log.info("Reached reels saved in an earlier complete scan — stopping the reels scan.")
                    break
        if complete and not gaps and self.opt.since is None and self.opt.until is None:
            self.save_state(**{f"{source}_scan_completed_utc": iso_utc(utc_now())})

    def retry_pending(self) -> None:
        """Retries posts that failed earlier (or lost files) and were not seen in this run's scans."""
        pending = [
            rec for rec in sorted(self.records.values(), key=sort_key)
            if rec["shortcode"] not in self.seen_this_run
            and not self.is_done(rec)
            and self.in_range(parse_iso_utc(rec.get("date_utc")))
        ]
        if not pending:
            return
        log.info("")
        log.info("Retrying %d post(s) that are incomplete from earlier runs…", len(pending))
        for index, rec in enumerate(pending, start=1):
            shortcode = rec["shortcode"]
            sources = rec.get("sources") or ["posts"]
            self.process(
                lambda: self.retrier.call(lambda: self.load_post(shortcode), f"Loading post {shortcode}"),
                f"[retry {index}/{len(pending)}]", sources[0], shortcode,
            )

    # ---------------------------------------------------------------- one post

    def process(self, get_post: Callable[[], Any], label: str, source: str, shortcode: str) -> str:
        """Archives one post. Returns 'archived', 'skipped' or 'failed'. Never loses earlier work."""
        post = None
        self.seen_this_run.add(shortcode)
        try:
            post = get_post()
            did_network = self._archive_post(post, label, source)
        except (KeyboardInterrupt, FatalStop, AbortDownloadException):
            raise
        except Exception as err:  # noqa: BLE001 - one failed post must not stop the backup
            if self.interrupted:
                raise KeyboardInterrupt from err
            if isinstance(err, OSError) and err.errno in (errno.ENOSPC, getattr(errno, "EDQUOT", -1)):
                raise FatalStop(f"The disk is full ({err}). Free some space and re-run the same command.") from err
            self._record_failure(post, shortcode, source, label, err)
            if isinstance(err, LoginRequiredException):
                raise FatalStop(LOGIN_WALL_ADVICE) from err
            if is_rate_limited(err):
                raise FatalStop(RATE_LIMIT_ADVICE) from err
            if not isinstance(err, (QueryReturnedNotFoundException, BadResponseException, MediaUnavailable)):
                self.consecutive_failures += 1
            if self.consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT:
                raise FatalStop(
                    f"{self.consecutive_failures} posts in a row failed (last error: {one_line(err)}). "
                    "The Internet connection or Instagram access is probably down. Re-run the same "
                    "command later to continue."
                ) from err
            return "failed"
        self.consecutive_failures = 0
        if not did_network:
            return "skipped"
        if self.opt.delay > 0:
            self.sleep(self.opt.delay * random.uniform(0.5, 1.5))
        return "archived"

    def _record_failure(self, post: Any, shortcode: str, source: str, label: str, err: Exception) -> None:
        self.stats.failed += 1
        self.stats.failed_shortcodes.append(shortcode)
        if isinstance(err, QueryReturnedNotFoundException):
            message = f"post is no longer available on Instagram ({one_line(err)})"
        else:
            message = one_line(err)
        expected = isinstance(err, TRANSIENT_ERRORS + PERMANENT_ERRORS + (MediaUnavailable,))
        log.error("%s Failed: %s — %s", label, shortcode, message, exc_info=None if expected else err)
        if post is not None:
            shortcode = optional_value(lambda: post.shortcode, shortcode)
        rec = dict(self.records.get(shortcode) or {})
        if not rec:
            posted = optional_value(lambda: post_date_utc(post)) if post is not None else None
            rec = {
                "shortcode": shortcode,
                "url": f"https://www.instagram.com/p/{shortcode}/",
                "date_utc": iso_utc(posted) if posted else None,
                "timestamp": int(posted.timestamp()) if posted else None,
                "media_type": None,
                "caption": None,
                "sources": [source],
                "media": [],
                "media_files": [],
                "metadata_complete": False,
            }
        rec["status"] = "failed"
        rec["error"] = message
        rec["last_attempt_utc"] = iso_utc(utc_now())
        if source not in rec.setdefault("sources", []):
            rec["sources"].append(source)
        self._save_record(rec)

    def _collect_metadata(self, post: Any, source: str) -> Dict[str, Any]:
        posted = post_date_utc(post)
        caption = post.caption or ""
        typename = post.typename
        product_type = raw_node(post).get("product_type")
        return {
            "shortcode": post.shortcode,
            "url": f"https://www.instagram.com/p/{post.shortcode}/",
            "date_utc": iso_utc(posted),
            "timestamp": int(posted.timestamp()),
            "media_type": classify_media_type(typename, product_type, source),
            "typename": typename,
            "product_type": product_type,
            "caption": caption,
            "hashtags": extract_hashtags(caption),
            "mentions": optional_value(lambda: post.caption_mentions, []),
            "tagged_users": optional_value(lambda: post.tagged_users),
            "likes": optional_value(lambda: post.likes),
            "comments": optional_value(lambda: post.comments),
            "sources": [source],
            "status": "incomplete",
            "error": None,
            "media": [],
            "media_files": [],
            "metadata_complete": True,
        }

    def _archive_post(self, post: Any, label: str, source: str) -> bool:
        """Returns True if Instagram was contacted for this post, False if it was skipped."""
        shortcode = post.shortcode
        existing = self.records.get(shortcode)
        if existing is not None and self.is_done(existing):
            self.stats.skipped += 1
            if source not in (existing.get("sources") or []):
                updated = dict(existing)
                updated["sources"] = list(existing.get("sources") or []) + [source]
                self._save_record(updated)
            log.info("%s Already exists — skipped: %s", label, shortcode)
            return False

        record = self.retrier.call(lambda: self._collect_metadata(post, source), f"Reading metadata of {shortcode}")
        now = iso_utc(utc_now())
        if existing is not None:
            if existing.get("metadata_complete"):
                for key in PRESERVED_FIELDS:
                    if key in existing:
                        if key == "caption" and existing[key] != record["caption"]:
                            record["caption_latest"] = record["caption"]
                            log.info("    Note: the caption changed on Instagram since it was archived; "
                                     "the original caption is kept.")
                        record[key] = existing[key]
            record["sources"] = sorted(set(existing.get("sources") or []) | {source})
        record.setdefault("first_archived_utc", None)
        record["first_archived_utc"] = record["first_archived_utc"] or now
        record["last_updated_utc"] = now

        try:
            items = self.retrier.call(lambda: plan_media(post), f"Reading the media list of {shortcode}")
        except MediaUnavailable as err:
            log.info("    %s — reloading the post…", err)
            post = self.retrier.call(lambda: self.load_post(shortcode), f"Reloading post {shortcode}")
            items = self.retrier.call(lambda: plan_media(post), f"Reading the media list of {shortcode}")
        posted = parse_iso_utc(record["date_utc"]) or post_date_utc(post)
        base = media_basename(posted, shortcode)
        described = record["media_type"] + (f", {len(items)} items" if len(items) > 1 else "")
        verb = "Saving metadata of" if self.opt.metadata_only else "Downloading"
        log.info("%s %s %s (%s, %s)…", label, verb, shortcode, f"{posted:%Y-%m-%d}", described)

        if self.opt.metadata_only:
            record["media"] = [{
                "index": item.index,
                "type": item.kind,
                "file": base + f"_{item.index:02d}" + (ext_from_url(item.url) or (".mp4" if item.kind == "video" else ".jpg")),
                "size": None,
                "downloaded": False,
                "cover": None,
            } for item in items]
            record["media_files"] = []
            record["status"] = "metadata_only"
            self._save_record(record)
            self._save_raw(post, base)
            if existing is None:
                self.stats.new_posts += 1
            log.info("%s Metadata saved: %s", label, shortcode)
            return True

        # Save the metadata before downloading, so the caption is kept even if the media fails.
        self._save_record(record)
        self._save_raw(post, base)
        entries: List[Dict[str, Any]] = []
        mtime = posted.timestamp()
        try:
            try:
                self._download_items(shortcode, base, items, entries, mtime)
            except (QueryReturnedForbiddenException, QueryReturnedNotFoundException) as err:
                # Signed media URLs expire (e.g. when resuming from a saved position). Reload the post once.
                log.info("    Media link rejected (%s) — reloading the post to get fresh links…", one_line(err, 80))
                fresh = self.retrier.call(lambda: self.load_post(shortcode), f"Reloading post {shortcode}")
                items = self.retrier.call(lambda: plan_media(fresh), f"Reading the media list of {shortcode}")
                entries.clear()
                self._download_items(shortcode, base, items, entries, mtime)
        except BaseException:
            record["media"] = list(entries)
            record["media_files"] = record_files(record)
            self._save_record(record)
            raise
        record["media"] = entries
        record["media_files"] = record_files(record)
        record["status"] = "complete"
        record["error"] = None
        self._save_record(record)
        if existing is None:
            self.stats.new_posts += 1
        images = sum(1 for entry in entries if entry["type"] == "image")
        videos = len(entries) - images
        counts = ", ".join(part for part in (
            f"{images} image{'s' if images != 1 else ''}" if images else "",
            f"{videos} video{'s' if videos != 1 else ''}" if videos else "",
        ) if part)
        log.info("%s Download completed: %s (%s)", label, shortcode, counts)
        return True

    def _download_items(self, shortcode: str, base: str, items: List[MediaItem],
                        entries: List[Dict[str, Any]], mtime: float) -> None:
        for item in items:
            stem = f"{base}_{item.index:02d}"
            what = f"Download of {shortcode} item {item.index}/{len(items)}"
            path = self._ensure_file(item.url, stem, item.kind, what, mtime)
            entry = {
                "index": item.index,
                "type": item.kind,
                "file": path.name,
                "size": path.stat().st_size,
                "downloaded": True,
                "cover": None,
            }
            if item.kind == "video" and item.cover_url:
                try:
                    cover = self._ensure_file(item.cover_url, stem + "_cover", "cover", what + " (cover)", mtime)
                    entry["cover"] = cover.name
                except (KeyboardInterrupt, FatalStop):
                    raise
                except Exception as err:  # noqa: BLE001 - a cover image is optional
                    if self.interrupted:
                        raise KeyboardInterrupt from err
                    log.warning("    Could not save the video cover of %s item %d: %s",
                                shortcode, item.index, one_line(err))
            entries.append(entry)

    def _find_valid(self, stem: str) -> Optional[Path]:
        for path in sorted(self.paths.media.glob(glob.escape(stem) + ".*")):
            if path.suffix.lower() in MEDIA_EXTS and media_problem(path) is None:
                return path
        return None

    def _ensure_file(self, url: str, stem: str, kind: str, what: str, mtime: Optional[float]) -> Path:
        existing = self._find_valid(stem)
        if existing is not None:
            log.info("    = %s (already saved)", existing.name)
            return existing
        default_ext = ext_from_url(url) or (".mp4" if kind == "video" else ".jpg")
        path, size = self.retrier.call(lambda: self._download(url, self.paths.media, stem, default_ext, mtime), what)
        if kind == "video":
            self.stats.videos += 1
        elif kind == "cover":
            self.stats.covers += 1
        else:
            self.stats.images += 1
        self.stats.bytes += size
        log.info("    + %s (%s)", path.name, human_size(size))
        return path

    def _download(self, url: str, folder: Path, stem: str, default_ext: str,
                  mtime: Optional[float] = None) -> Tuple[Path, int]:
        """Streams a URL into folder/stem.ext via a .part file. Only complete, valid files are kept."""
        response = self.fetcher.open(url)
        try:
            headers = response.headers or {}
            ext = ext_from_content_type(headers.get("Content-Type")) or default_ext
            final = folder / (stem + ext)
            part = folder / (stem + ext + ".part")
            expected = None
            if not headers.get("Content-Encoding"):
                try:
                    expected = int(headers.get("Content-Length"))
                except (TypeError, ValueError):
                    expected = None
            written = 0
            with open(part, "wb") as fh:
                for chunk in response.iter_content(chunk_size=CHUNK_SIZE):
                    if chunk:
                        fh.write(chunk)
                        written += len(chunk)
                fh.flush()
                os.fsync(fh.fileno())
        finally:
            response.close()
        if expected is not None and written != expected:
            part.unlink(missing_ok=True)
            raise IncompleteDownload(f"received {written} of {expected} bytes")
        problem = media_problem(part, suffix=ext)
        if problem:
            part.unlink(missing_ok=True)
            raise IncompleteDownload(f"downloaded data is not usable: {problem}")
        os.replace(part, final)
        if mtime is not None:
            os.utime(final, (time.time(), mtime))
        return final, written

    def _save_raw(self, post: Any, base: str) -> None:
        """Keeps Instagram's original data for the post (first version only)."""
        target = self.paths.raw / f"{base}.json.xz"
        if target.exists():
            return
        tmp = self.paths.raw / f"{base}.tmp.json.xz"
        try:
            instaloader.save_structure_to_file(post, str(tmp))
            os.replace(tmp, target)
        except Exception as err:  # noqa: BLE001 - raw data is a bonus, never a reason to fail
            tmp.unlink(missing_ok=True)
            log.warning("Could not save raw metadata of %s: %s", base, one_line(err))

    # ---------------------------------------------------------------- outputs

    def sorted_records(self) -> List[Dict[str, Any]]:
        return sorted(self.records.values(), key=sort_key)

    def summary_lines(self) -> List[str]:
        records = list(self.records.values())
        by_status: Dict[str, int] = {}
        for rec in records:
            by_status[rec.get("status") or "unknown"] = by_status.get(rec.get("status") or "unknown", 0) + 1
        images = videos = covers = 0
        for rec in records:
            for entry in rec.get("media") or []:
                if entry.get("downloaded"):
                    if entry.get("type") == "video":
                        videos += 1
                    else:
                        images += 1
                if entry.get("cover"):
                    covers += 1
        reported = self.profile_snapshot.get("mediacount")
        discovered = f"{len(records)}"
        if isinstance(reported, int):
            discovered += f"  (profile grid shows {reported})"
        lines = [
            f"Posts discovered:            {discovered}",
            f"Posts successfully archived: {by_status.get('complete', 0)}",
            f"Failed:                      {by_status.get('failed', 0) + by_status.get('incomplete', 0)}",
        ]
        if by_status.get("metadata_only"):
            lines.append(f"Metadata only (no media):    {by_status['metadata_only']}")
        lines += [
            f"Images downloaded:           {images}  (+{self.stats.images} this run)",
            f"Videos downloaded:           {videos}  (+{self.stats.videos} this run)",
            f"Video covers:                {covers}",
            f"This run: {self.stats.new_posts} new post(s), {self.stats.skipped} already archived, "
            f"{self.stats.failed} failed, {human_size(self.stats.bytes)} downloaded",
        ]
        return lines

    def write_outputs(self) -> None:
        records = self.sorted_records()
        generated = iso_utc(utc_now())
        atomic_write_json(self.paths.posts_json, {
            "username": self.username,
            "generated_utc": generated,
            "tool_version": TOOL_VERSION,
            "instaloader_version": instaloader.__version__,
            "post_count": len(records),
            "profile": self.profile_snapshot,
            "posts": records,
        })
        atomic_write_text(self.paths.posts_csv, build_csv(records), encoding="utf-8-sig")
        atomic_write_text(self.paths.readme, build_readme_txt(self.username, generated, self.summary_lines(),
                                                             self.stats.stopped_reason))
        if self.opt.html:
            atomic_write_text(self.paths.index_html, render_gallery(
                self.username, self.profile_snapshot, records, self.paths.latest_profile_pic(), generated))


# --------------------------------------------------------------------------- output formats


def csv_row(rec: Dict[str, Any]) -> Dict[str, Any]:
    def joined(value: Any) -> str:
        if isinstance(value, list):
            return ";".join(str(v) for v in value)
        return "" if value is None else str(value)

    return {
        "shortcode": rec.get("shortcode"),
        "url": rec.get("url"),
        "date_utc": rec.get("date_utc"),
        "media_type": rec.get("media_type"),
        "caption": rec.get("caption") or "",
        "likes": joined(rec.get("likes")),
        "comments": joined(rec.get("comments")),
        "hashtags": joined(rec.get("hashtags")),
        "mentions": joined(rec.get("mentions")),
        "tagged_users": joined(rec.get("tagged_users")),
        "media_count": len(rec.get("media") or []),
        "media_files": joined(rec.get("media_files")),
        "status": rec.get("status"),
        "error": rec.get("error") or "",
        "sources": joined(rec.get("sources")),
        "first_archived_utc": rec.get("first_archived_utc") or "",
    }


def build_csv(records: List[Dict[str, Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for rec in records:
        writer.writerow(csv_row(rec))
    return buffer.getvalue()


def build_readme_txt(username: str, generated: str, summary: List[str], stopped: Optional[str]) -> str:
    status = f"\nThe last run stopped early: {stopped}\n" if stopped else ""
    summary_text = "\n".join("  " + line for line in summary)
    return f"""Instagram backup of @{username}
Created with backup_instagram.py {TOOL_VERSION} (Instaloader {instaloader.__version__}).
Last updated: {generated}
{status}
CONTENTS
  index.html   Offline gallery. Double-click to open it in a web browser.
  posts.json   All post metadata (UTF-8 JSON).
  posts.csv    The same data as a spreadsheet (UTF-8; opens in Numbers or Excel).
               Lists (hashtags, users, files) are separated with ";".
  media/       Photos and videos, named YYYY-MM-DD_HH-MM-SS_SHORTCODE_NN.ext
               (publication time in UTC, NN = position in a carousel).
               Video preview images end with _cover.jpg.
               Profile pictures: profile_pic_YYYY-MM-DD.jpg (older versions are kept).
  metadata/    profile.json  profile snapshot (older versions: profile_<date>.json)
               posts/        one JSON record per post (the source of truth)
               raw/          original data returned by Instagram (.json.xz)
               state.json, resume_*.json.xz  progress of the scans
  errors.log   Warnings and errors of all runs (UTC timestamps).

LAST RUN
{summary_text}

UPDATE OR RESUME
  Run the same command again, for example:
    python3 backup_instagram.py {username}
  Posts that are already complete are skipped; failed posts are retried.

CHECK INTEGRITY
    python3 backup_instagram.py {username} --verify
"""


GALLERY_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@__USERNAME__ — Instagram backup</title>
<style>
:root { --bg:#f6f7f9; --card:#fff; --text:#1d2127; --muted:#667085; --border:#e3e6ea; --accent:#2f6fde; --media:#0c0d0e; --bad:#c9372c; }
@media (prefers-color-scheme: dark) { :root { --bg:#111315; --card:#1a1d21; --text:#e7e9ec; --muted:#9aa2ad; --border:#2b3036; --accent:#7ea8ff; --bad:#ff7b72; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
header { max-width:1240px; margin:0 auto; padding:24px 16px 8px; display:flex; gap:20px; align-items:center; flex-wrap:wrap; }
.avatar { width:96px; height:96px; border-radius:50%; object-fit:cover; border:1px solid var(--border); background:var(--card); }
h1 { margin:0; font-size:22px; }
.bio { white-space:pre-wrap; margin:4px 0; }
.meta { color:var(--muted); font-size:13px; }
.controls { position:sticky; top:0; z-index:5; background:var(--bg); max-width:1240px; margin:0 auto; padding:10px 16px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.controls input { flex:1 1 260px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--text); font:inherit; }
.controls button { padding:8px 12px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--text); font:inherit; cursor:pointer; }
main { max-width:1240px; margin:0 auto; padding:4px 16px 48px; display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:16px; }
.card { background:var(--card); border:1px solid var(--border); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; }
.card[hidden] { display:none; }
.media { position:relative; background:var(--media); aspect-ratio:4/5; }
.strip { display:flex; height:100%; overflow-x:auto; scroll-snap-type:x mandatory; scrollbar-width:none; }
.strip::-webkit-scrollbar { display:none; }
.slide { flex:0 0 100%; height:100%; scroll-snap-align:start; display:flex; align-items:center; justify-content:center; }
.slide img, .slide video { width:100%; height:100%; object-fit:contain; display:block; }
.missing { color:#aab; font-size:13px; padding:16px; text-align:center; }
.nav { position:absolute; top:50%; transform:translateY(-50%); width:34px; height:34px; border:none; border-radius:50%; background:rgba(0,0,0,.55); color:#fff; font-size:20px; line-height:34px; cursor:pointer; padding:0; }
.nav.prev { left:8px; } .nav.next { right:8px; }
.counter { position:absolute; top:8px; right:8px; background:rgba(0,0,0,.6); color:#fff; font-size:12px; padding:2px 8px; border-radius:10px; }
.body { padding:10px 12px 12px; display:flex; flex-direction:column; gap:6px; }
.row { display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; font-size:13px; color:var(--muted); }
.badge { display:inline-block; font-size:11px; padding:1px 7px; margin-right:4px; border:1px solid var(--border); border-radius:10px; text-transform:uppercase; letter-spacing:.03em; }
.badge.bad { color:var(--bad); border-color:var(--bad); }
.caption { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
.caption.clamp { display:-webkit-box; -webkit-line-clamp:6; -webkit-box-orient:vertical; overflow:hidden; }
.more { align-self:flex-start; background:none; border:none; padding:0; color:var(--accent); font:inherit; font-size:13px; cursor:pointer; }
.empty { grid-column:1/-1; text-align:center; color:var(--muted); padding:48px 0; }
</style>
</head>
<body>
<header id="profile"></header>
<div class="controls">
  <input id="search" type="search" placeholder="Search captions, hashtags, users, shortcodes…" aria-label="Search">
  <button id="sort" type="button" title="Reverse the order"></button>
  <span id="count" class="meta"></span>
</div>
<main id="grid"></main>
<script id="backup-data" type="application/json">__DATA__</script>
<script>
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("backup-data").textContent);
  var grid = document.getElementById("grid");
  var search = document.getElementById("search");
  var sortButton = document.getElementById("sort");
  var countLabel = document.getElementById("count");
  var newestFirst = false;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function src(name) { return "media/" + encodeURIComponent(name); }
  function when(iso) { return iso ? iso.replace("T", " ").replace("Z", " UTC") : "unknown date"; }
  function num(n) { return (n === null || n === undefined) ? null : Number(n).toLocaleString(); }
  function plural(n, word) { return num(n) + " " + word + (n === 1 ? "" : "s"); }

  function renderProfile() {
    var p = DATA.profile || {};
    var box = document.getElementById("profile");
    if (DATA.profile_pic) {
      var pic = el("img", "avatar"); pic.src = src(DATA.profile_pic); pic.alt = "Profile picture"; box.appendChild(pic);
    }
    var text = el("div");
    text.appendChild(el("h1", null, "@" + DATA.username));
    if (p.full_name) text.appendChild(el("div", null, p.full_name));
    if (p.biography) text.appendChild(el("p", "bio", p.biography));
    if (p.external_url && /^https?:\\/\\//i.test(p.external_url)) {
      var link = el("a", null, p.external_url); link.href = p.external_url; link.target = "_blank"; link.rel = "noopener noreferrer";
      text.appendChild(link);
    }
    var facts = [plural(DATA.posts.length, "post") + " archived"];
    if (p.followers !== null && p.followers !== undefined) facts.push(plural(p.followers, "follower") + " (at backup time)");
    facts.push("backup updated " + when(DATA.generated_utc));
    text.appendChild(el("div", "meta", facts.join(" · ")));
    box.appendChild(text);
  }

  function renderMedia(post) {
    var wrap = el("div", "media");
    var items = post.media || [];
    if (!items.length) { wrap.appendChild(el("div", "missing", "No media saved for this post")); return wrap; }
    var strip = el("div", "strip");
    items.forEach(function (m, i) {
      var slide = el("div", "slide");
      if (!m.file || !m.downloaded) {
        slide.appendChild(el("div", "missing", "Media not downloaded"));
      } else if (m.type === "video") {
        var video = el("video");
        video.controls = true; video.preload = m.cover ? "none" : "metadata"; video.setAttribute("playsinline", "");
        if (m.cover) video.poster = src(m.cover);
        video.src = src(m.file);
        slide.appendChild(video);
      } else {
        var img = el("img"); img.loading = "lazy"; img.decoding = "async";
        img.alt = "Post " + post.shortcode + ", item " + (i + 1); img.src = src(m.file);
        slide.appendChild(img);
      }
      strip.appendChild(slide);
    });
    wrap.appendChild(strip);
    if (items.length > 1) {
      var counter = el("div", "counter", "1/" + items.length);
      var prev = el("button", "nav prev", "\\u2039"); prev.type = "button"; prev.setAttribute("aria-label", "Previous item");
      var next = el("button", "nav next", "\\u203a"); next.type = "button"; next.setAttribute("aria-label", "Next item");
      prev.onclick = function () { strip.scrollBy({ left: -strip.clientWidth, behavior: "smooth" }); };
      next.onclick = function () { strip.scrollBy({ left: strip.clientWidth, behavior: "smooth" }); };
      strip.addEventListener("scroll", function () {
        var index = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
        counter.textContent = (index + 1) + "/" + items.length;
      }, { passive: true });
      wrap.appendChild(prev); wrap.appendChild(next); wrap.appendChild(counter);
    }
    return wrap;
  }

  function renderCard(post) {
    var card = el("article", "card");
    card.id = "post-" + post.shortcode;
    card.appendChild(renderMedia(post));
    var body = el("div", "body");
    var top = el("div", "row");
    top.appendChild(el("span", null, when(post.date_utc)));
    var link = el("a", null, post.shortcode); link.href = post.url; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.title = "Open the original post on Instagram";
    top.appendChild(link);
    body.appendChild(top);
    var info = el("div", "row");
    var badges = el("span");
    badges.appendChild(el("span", "badge", post.media_type || "post"));
    if (post.status === "failed" || post.status === "incomplete") badges.appendChild(el("span", "badge bad", "incomplete"));
    if (post.status === "metadata_only") badges.appendChild(el("span", "badge", "metadata only"));
    info.appendChild(badges);
    var stats = [];
    if (post.likes !== null && post.likes !== undefined) stats.push(plural(post.likes, "like"));
    if (post.comments !== null && post.comments !== undefined) stats.push(plural(post.comments, "comment"));
    info.appendChild(el("span", null, stats.join(" · ")));
    body.appendChild(info);
    if (post.caption) {
      var caption = el("p", "caption", post.caption);
      body.appendChild(caption);
      if (post.caption.length > 280 || post.caption.split("\\n").length > 6) {
        caption.classList.add("clamp");
        var more = el("button", "more", "Show more"); more.type = "button";
        more.onclick = function () { more.textContent = caption.classList.toggle("clamp") ? "Show more" : "Show less"; };
        body.appendChild(more);
      }
    }
    if (post.tagged_users && post.tagged_users.length) {
      body.appendChild(el("div", "meta", "Tagged: " + post.tagged_users.map(function (u) { return "@" + u; }).join(", ")));
    }
    card.appendChild(body);
    return card;
  }

  var entries = DATA.posts.map(function (post) {
    return {
      card: renderCard(post),
      text: [post.shortcode, post.caption || "", (post.tagged_users || []).join(" "), post.date_utc || "", post.media_type || ""].join("\\n").toLowerCase()
    };
  });
  var empty = el("div", "empty", "No posts match your search.");

  function render() {
    var term = search.value.trim().toLowerCase();
    var list = newestFirst ? entries.slice().reverse() : entries;
    var fragment = document.createDocumentFragment();
    var shown = 0;
    list.forEach(function (entry) {
      var match = !term || entry.text.indexOf(term) !== -1;
      entry.card.hidden = !match;
      if (match) shown++;
      fragment.appendChild(entry.card);
    });
    fragment.appendChild(empty);
    empty.hidden = shown > 0;
    grid.appendChild(fragment);
    sortButton.textContent = newestFirst ? "Order: newest first" : "Order: oldest first";
    countLabel.textContent = shown + " of " + entries.length + " posts";
  }

  sortButton.onclick = function () { newestFirst = !newestFirst; render(); };
  search.addEventListener("input", render);
  renderProfile();
  render();
})();
</script>
</body>
</html>
"""


def render_gallery(username: str, profile: Dict[str, Any], records: List[Dict[str, Any]],
                   profile_pic: Optional[str], generated: str) -> str:
    """Builds a self-contained offline gallery. Data is embedded, so it works from file://."""
    posts = [{
        "shortcode": rec.get("shortcode"),
        "url": rec.get("url"),
        "date_utc": rec.get("date_utc"),
        "media_type": rec.get("media_type"),
        "caption": rec.get("caption"),
        "likes": rec.get("likes"),
        "comments": rec.get("comments"),
        "tagged_users": rec.get("tagged_users") or [],
        "status": rec.get("status"),
        "media": [{
            "type": entry.get("type"),
            "file": entry.get("file"),
            "downloaded": bool(entry.get("downloaded")),
            "cover": entry.get("cover"),
        } for entry in rec.get("media") or []],
    } for rec in records]
    data = {
        "username": username,
        "generated_utc": generated,
        "profile": {key: profile.get(key) for key in ("full_name", "biography", "external_url", "followers")},
        "profile_pic": profile_pic,
        "posts": posts,
    }
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    # Escape characters that could end the <script> element early.
    payload = payload.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    return GALLERY_TEMPLATE.replace("__USERNAME__", username).replace("__DATA__", payload)


# --------------------------------------------------------------------------- verify


@dataclass
class VerifyReport:
    records: int = 0
    by_status: Dict[str, int] = field(default_factory=dict)
    files_checked: int = 0
    missing_media: List[str] = field(default_factory=list)
    missing_files: List[str] = field(default_factory=list)
    corrupted: List[str] = field(default_factory=list)
    duplicates: List[str] = field(default_factory=list)
    unreadable: List[str] = field(default_factory=list)
    out_of_sync: List[str] = field(default_factory=list)
    leftovers: List[str] = field(default_factory=list)
    orphans: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)

    @property
    def problem_count(self) -> int:
        return (len(self.missing_media) + len(self.missing_files) + len(self.corrupted)
                + len(self.duplicates) + len(self.unreadable) + len(self.out_of_sync))


def _shortcode_counts(shortcodes: List[str]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for shortcode in shortcodes:
        counts[shortcode] = counts.get(shortcode, 0) + 1
    return counts


def verify_backup(root: Path) -> VerifyReport:
    """Checks a backup folder offline. Never changes anything."""
    paths = BackupPaths(root)
    report = VerifyReport()

    records: Dict[str, Dict[str, Any]] = {}
    record_sources: Dict[str, List[str]] = {}
    for path, rec, error in read_record_files(paths.records):
        if rec is None:
            report.unreadable.append(f"metadata/posts/{path.name}: {error}")
            continue
        record_sources.setdefault(rec["shortcode"], []).append(path.name)
        records.setdefault(rec["shortcode"], rec)
    for shortcode, names in sorted(record_sources.items()):
        if len(names) > 1:
            report.duplicates.append(f"{shortcode}: {len(names)} records in metadata/posts ({', '.join(names)})")
    report.records = len(records)
    for rec in records.values():
        status = rec.get("status") or "unknown"
        report.by_status[status] = report.by_status.get(status, 0) + 1

    # posts.json / posts.csv
    json_codes: Optional[List[str]] = None
    if paths.posts_json.exists():
        try:
            data = read_json(paths.posts_json)
            posts = data.get("posts") if isinstance(data, dict) else data
            json_codes = [str(p.get("shortcode")) for p in posts or [] if isinstance(p, dict)]
        except (OSError, ValueError, AttributeError) as err:
            report.unreadable.append(f"posts.json: {one_line(err)}")
    else:
        report.notes.append("posts.json does not exist yet (it is written at the end of each run).")
    csv_codes: Optional[List[str]] = None
    if paths.posts_csv.exists():
        try:
            with open(paths.posts_csv, encoding="utf-8-sig", newline="") as fh:
                csv_codes = [row.get("shortcode") or "" for row in csv.DictReader(fh)]
        except (OSError, csv.Error, UnicodeDecodeError) as err:
            report.unreadable.append(f"posts.csv: {one_line(err)}")
    for name, codes in (("posts.json", json_codes), ("posts.csv", csv_codes)):
        if codes is None:
            continue
        for shortcode, count in sorted(_shortcode_counts(codes).items()):
            if count > 1:
                report.duplicates.append(f"{shortcode}: listed {count} times in {name}")
        listed = set(codes)
        missing = sorted(set(records) - listed)
        extra = sorted(listed - set(records))
        if missing:
            report.out_of_sync.append(f"{name} is missing {len(missing)} archived post(s), e.g. {', '.join(missing[:5])}")
        if extra:
            report.out_of_sync.append(f"{name} lists {len(extra)} post(s) without a metadata record, e.g. {', '.join(extra[:5])}")

    # Media referenced by records
    referenced: Set[str] = set()
    for rec in sorted(records.values(), key=sort_key):
        shortcode = rec["shortcode"]
        status = rec.get("status")
        media = rec.get("media") or []
        if status in ("failed", "incomplete"):
            detail = f": {rec['error']}" if rec.get("error") else ""
            report.missing_media.append(f"{shortcode} ({rec.get('date_utc') or 'unknown date'}) — status {status}{detail}")
        elif status == "metadata_only":
            report.missing_media.append(f"{shortcode} — metadata only, media not downloaded yet")
        elif status == "complete" and not media:
            report.missing_media.append(f"{shortcode} — marked complete but lists no media")
        for entry in media:
            names = []
            if entry.get("downloaded") and entry.get("file"):
                names.append(entry["file"])
            if entry.get("cover"):
                names.append(entry["cover"])
            for name in names:
                referenced.add(name)
                path = paths.media / name
                if not path.exists():
                    report.missing_files.append(f"{shortcode}: media/{name}")
                    continue
                report.files_checked += 1
                problem = media_problem(path)
                if problem:
                    report.corrupted.append(f"media/{name} ({shortcode}): {problem}")

    # Files on disk
    if paths.media.is_dir():
        for path in sorted(paths.media.iterdir()):
            if not path.is_file() or path.name.startswith("."):
                continue
            if path.name.endswith((".part", ".tmp")):
                report.leftovers.append(f"media/{path.name}")
                continue
            if path.name in referenced:
                continue
            if path.name.startswith("profile_pic_"):
                report.files_checked += 1
                problem = media_problem(path)
                if problem:
                    report.corrupted.append(f"media/{path.name}: {problem}")
                continue
            report.orphans.append(f"media/{path.name}")
            problem = media_problem(path)
            if problem:
                report.corrupted.append(f"media/{path.name} (not used by any record): {problem}")
    else:
        report.notes.append("media/ folder does not exist.")

    has_profile_pic = paths.media.is_dir() and any(paths.media.glob("profile_pic_*"))
    if not has_profile_pic:
        report.notes.append("No profile picture saved.")
    try:
        reported = read_json(paths.profile_json).get("mediacount")
        if isinstance(reported, int) and reported > len(records):
            report.notes.append(f"The profile grid showed {reported} posts at the last backup; {len(records)} are archived. "
                                "Run the backup again to get the rest (some posts may be unavailable).")
    except (OSError, ValueError, AttributeError):
        pass
    return report


def print_verify_report(root: Path, report: VerifyReport) -> None:
    def section(title: str, items: List[str], limit: int = 50) -> None:
        print(f"{title}: {len(items)}")
        for item in items[:limit]:
            print(f"  - {item}")
        if len(items) > limit:
            print(f"  … and {len(items) - limit} more")

    print(f"Verifying backup: {root}")
    print(f"Metadata records: {report.records}  "
          + ", ".join(f"{status}: {count}" for status, count in sorted(report.by_status.items())))
    print(f"Media files checked: {report.files_checked}")
    print()
    section("Posts with missing media", report.missing_media)
    section("Records referencing missing files", report.missing_files)
    section("Corrupted or zero-byte media", report.corrupted)
    section("Duplicated shortcode records", report.duplicates)
    section("Unreadable metadata files", report.unreadable)
    section("posts.json / posts.csv out of sync", report.out_of_sync)
    if report.leftovers:
        section("Leftover partial downloads (harmless, replaced on the next run)", report.leftovers, 10)
    if report.orphans:
        section("Media files not used by any record (info)", report.orphans, 10)
    for note in report.notes:
        print(f"Note: {note}")
    print()
    if report.problem_count:
        print(f"Result: {report.problem_count} problem(s) found. Run the normal backup command again to "
              "re-download missing or corrupted media and to regenerate posts.json/posts.csv.")
    else:
        print("Result: OK — no problems found.")


# --------------------------------------------------------------------------- CLI


class _ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        if record.levelno >= logging.ERROR:
            return "ERROR: " + message
        if record.levelno >= logging.WARNING:
            return "WARNING: " + message
        return message


def setup_logging(errors_log: Optional[Path]) -> None:
    log.setLevel(logging.DEBUG)
    log.propagate = False
    for handler in list(log.handlers):
        log.removeHandler(handler)
        handler.close()
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(_ConsoleFormatter())
    log.addHandler(console)
    if errors_log is not None:
        file_handler = logging.FileHandler(errors_log, encoding="utf-8")
        file_handler.setLevel(logging.WARNING)
        formatter = logging.Formatter("%(asctime)sZ %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
        formatter.converter = time.gmtime
        file_handler.setFormatter(formatter)
        log.addHandler(file_handler)


def route_instaloader_messages(context: Any, archiver: Archiver) -> None:
    """Sends Instaloader's warnings to our log (console + errors.log) instead of bare stderr."""

    def error(msg: Any, repeat_at_end: bool = True) -> None:
        # Ctrl+C stops this tool (progress is saved), so drop Instaloader's "skip with ^C" hint.
        text = " ".join(str(msg).split()).replace("[retrying; skip with ^C]", "[retrying]")
        if "[skipped by user]" in text:
            archiver.interrupted = True  # Ctrl+C pressed while Instaloader was waiting to retry
        if text:
            log.warning("Instaloader: %s", text)

    context.error = error


def make_loader() -> Any:
    return instaloader.Instaloader(
        sleep=True,  # Instaloader's own random pauses between requests
        quiet=False,  # show Instaloader's rate-limit waiting messages
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        save_metadata=False,
        post_metadata_txt_pattern="",
        max_connection_attempts=3,
        request_timeout=REQUEST_TIMEOUT_SECONDS,
    )


def parse_date_arg(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid date {value!r}, expected YYYY-MM-DD") from None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="backup_instagram.py",
        description=(
            "Back up the publicly visible content of a public Instagram profile (photos, carousels, "
            "videos, Reels, profile picture and metadata) into a local folder, with an offline HTML "
            "gallery. Re-run the same command to resume an interrupted backup."
        ),
        epilog=(
            "examples:\n"
            "  python3 backup_instagram.py some_username\n"
            "  python3 backup_instagram.py some_username --output ~/Backups --no-reels\n"
            "  python3 backup_instagram.py some_username --since 2023-01-01 --until 2023-12-31\n"
            "  python3 backup_instagram.py some_username --verify\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("username", help="Instagram username (also accepts @name or the profile URL)")
    parser.add_argument("--output", "-o", metavar="PATH", default="backup",
                        help="base folder for backups (default: ./backup); the profile is saved in PATH/USERNAME")
    parser.add_argument("--reels", action=argparse.BooleanOptionalAction, default=True,
                        help="also scan the profile's Reels tab")
    parser.add_argument("--html", action=argparse.BooleanOptionalAction, default=True,
                        help="generate the offline index.html gallery")
    parser.add_argument("--metadata-only", action="store_true",
                        help="save metadata only, download no photos/videos")
    parser.add_argument("--since", metavar="YYYY-MM-DD", type=parse_date_arg,
                        help="only posts published on or after this date (UTC)")
    parser.add_argument("--until", metavar="YYYY-MM-DD", type=parse_date_arg,
                        help="only posts published on or before this date (UTC)")
    parser.add_argument("--verify", action="store_true",
                        help="check an existing backup offline and report problems; downloads nothing")
    parser.add_argument("--delay", metavar="SECONDS", type=float, default=1.0,
                        help="extra pause between posts, on top of Instaloader's own pauses (default: 1)")
    parser.add_argument("--max-retries", metavar="N", type=int, default=5,
                        help="attempts per request for temporary errors, with exponential backoff (default: 5)")
    parser.add_argument("--login", metavar="YOUR_USERNAME",
                        help="optional fallback: use a saved Instaloader session of your own account "
                             "(create it with: instaloader --login YOUR_USERNAME). Not needed for public profiles.")
    parser.add_argument("--version", action="version",
                        version=f"%(prog)s {TOOL_VERSION} (instaloader {instaloader.__version__})")
    return parser


def run_backup(username: str, root: Path, args: argparse.Namespace, loader: Any = None,
               fetcher: Any = None, sleep: Callable[[float], None] = time.sleep) -> int:
    paths = BackupPaths(root)
    paths.create()
    setup_logging(paths.errors_log)
    options = Options(
        reels=args.reels,
        html=args.html,
        metadata_only=args.metadata_only,
        since=datetime(args.since.year, args.since.month, args.since.day, tzinfo=timezone.utc) if args.since else None,
        until=(datetime(args.until.year, args.until.month, args.until.day, tzinfo=timezone.utc) + timedelta(days=1)
               if args.until else None),
        delay=max(0.0, args.delay),
        max_attempts=args.max_retries,
    )
    loader = loader or make_loader()
    context = loader.context
    archiver = Archiver(username, paths, context, options, fetcher=fetcher, sleep=sleep)
    route_instaloader_messages(context, archiver)

    log.info("Instagram backup of @%s", username)
    log.info("Backup folder: %s", root)
    log.info("Tool %s, Instaloader %s, %s", TOOL_VERSION, instaloader.__version__,
             f"logged in as @{args.login}" if args.login else "no login (public content only)")
    if archiver.records:
        log.info("Already in the backup: %d post record(s). Complete posts will be skipped.", len(archiver.records))

    try:
        lock = RunLock(paths.lock).__enter__()
    except LockHeld as err:
        log.error("%s", err)
        loader.close()
        return EXIT_LOCKED

    exit_code = EXIT_OK
    started = iso_utc(utc_now())
    try:
        if args.login:
            try:
                loader.load_session_from_file(args.login)
            except FileNotFoundError:
                log.error("No saved Instaloader session for @%s. Create one first with:\n"
                          "    instaloader --login %s\nthen re-run this command.", args.login, args.login)
                return EXIT_USAGE
            if not archiver.retrier.call(loader.test_login, "Checking the saved login session"):
                log.error("The saved session for @%s has expired. Re-create it with: instaloader --login %s",
                          args.login, args.login)
                return EXIT_USAGE

        profile = archiver.retrier.call(lambda: instaloader.Profile.from_username(context, username),
                                        "Loading the profile")
        archiver.save_profile(profile)
        is_private = optional_value(lambda: profile.is_private, False)
        followed = optional_value(lambda: profile.followed_by_viewer, False)
        if is_private and not (args.login and followed):
            log.error("@%s is a private profile. This tool only backs up public profiles.", username)
            return EXIT_PROFILE
        total = optional_value(lambda: profile.mediacount)
        log.info("Profile: %s — %s posts in the grid.", optional_value(lambda: profile.full_name) or username,
                 total if total is not None else "unknown number of")

        if not options.metadata_only:
            archiver.save_profile_pic(profile)

        log.info("")
        log.info("Scanning posts…")
        posts = archiver.retrier.call(profile.get_posts, "Loading the post list")
        archiver.run_listing(posts, "posts", total)

        if options.reels:
            log.info("")
            log.info("Scanning the Reels tab…")
            try:
                reels = archiver.retrier.call(profile.get_reels, "Loading the Reels list")
                archiver.run_listing(reels, "reels", None)
            except ListingUnavailable as err:
                log.warning("Reels tab could not be scanned (%s). Reels shown in the main grid were saved as posts.",
                            one_line(err))
            except (KeyboardInterrupt, AbortDownloadException, FatalStop):
                raise
            except Exception as err:  # noqa: BLE001 - the Reels tab is optional
                if is_rate_limited(err):
                    raise FatalStop(RATE_LIMIT_ADVICE) from err
                log.warning("Reels tab is not accessible (%s). Reels shown in the main grid were saved as posts.",
                            one_line(err))

        archiver.retry_pending()
    except ProfileNotExistsException as err:
        log.error("Profile not found: %s Check the spelling. If the profile exists, Instagram may be "
                  "blocking anonymous access right now; try again later.", one_line(err))
        exit_code = EXIT_PROFILE
    except PrivateProfileNotFollowedException:
        log.error("@%s is a private profile. This tool only backs up public profiles.", username)
        exit_code = EXIT_PROFILE
    except LoginRequiredException as err:
        archiver.stats.stopped_reason = LOGIN_WALL_ADVICE
        log.error("Stopped: %s (%s)", LOGIN_WALL_ADVICE, one_line(err))
        exit_code = EXIT_STOPPED
    except AbortDownloadException as err:
        archiver.stats.stopped_reason = f"Instagram refused further requests ({one_line(err)})."
        log.error("Stopped: Instagram refused further requests (%s). %s", one_line(err), LOGIN_WALL_ADVICE)
        exit_code = EXIT_STOPPED
    except FatalStop as err:
        archiver.stats.stopped_reason = str(err)
        log.error("Stopped: %s", err)
        exit_code = EXIT_STOPPED
    except KeyboardInterrupt:
        archiver.stats.stopped_reason = "interrupted by the user (Ctrl+C)."
        log.info("")
        log.info("Interrupted. Progress is saved — re-run the same command to continue.")
        exit_code = EXIT_INTERRUPTED
    except TRANSIENT_ERRORS as err:
        advice = RATE_LIMIT_ADVICE if is_rate_limited(err) else "Check the Internet connection and re-run the same command."
        archiver.stats.stopped_reason = advice
        log.error("Stopped: could not reach Instagram (%s). %s", one_line(err), advice)
        exit_code = EXIT_STOPPED
    except Exception as err:  # noqa: BLE001 - keep whatever was archived
        archiver.stats.stopped_reason = f"unexpected error: {one_line(err)}"
        log.error("Stopped by an unexpected error: %s. Progress is saved; re-run to continue. If it happens "
                  "again, update Instaloader (python3 -m pip install -U instaloader).", one_line(err), exc_info=err)
        exit_code = EXIT_STOPPED
    finally:
        try:
            archiver.save_state(last_run_started_utc=started, last_run_finished_utc=iso_utc(utc_now()))
            archiver.write_outputs()
        except Exception as err:  # noqa: BLE001
            log.error("Could not write posts.json/posts.csv/index.html: %s", one_line(err), exc_info=err)
        lock.__exit__(None, None, None)
        loader.close()

    log.info("")
    log.info("=" * 60)
    for line in archiver.summary_lines():
        log.info(line)
    log.info("Backup folder: %s", root)
    if options.html:
        log.info("Gallery:       %s", paths.index_html)
    if archiver.stats.failed_shortcodes:
        log.info("Failed posts are listed in %s and will be retried on the next run.", paths.errors_log)
    if exit_code in (EXIT_STOPPED, EXIT_INTERRUPTED):
        log.info("The backup is not finished. Re-run the same command to continue.")
    log.info("=" * 60)
    if exit_code == EXIT_OK and any(rec.get("status") in ("failed", "incomplete") for rec in archiver.records.values()):
        exit_code = EXIT_SOME_FAILED
    return exit_code


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        username = normalize_username(args.username)
    except ValueError as err:
        parser.error(str(err))
    if args.since and args.until and args.since > args.until:
        parser.error("--since must not be later than --until")
    if args.max_retries < 1:
        parser.error("--max-retries must be at least 1")
    root = Path(args.output).expanduser().resolve() / username

    if args.verify:
        if not root.is_dir():
            print(f"No backup found at {root}", file=sys.stderr)
            return EXIT_USAGE
        report = verify_backup(root)
        print_verify_report(root, report)
        return EXIT_OK if report.problem_count == 0 else EXIT_SOME_FAILED

    return run_backup(username, root, args)


if __name__ == "__main__":
    sys.exit(main())
