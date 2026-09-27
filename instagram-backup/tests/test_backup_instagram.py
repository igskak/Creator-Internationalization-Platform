"""Offline tests for backup_instagram.py.

They use real Instaloader Post/NodeIterator objects built from fake Instagram data, a fake
media downloader, and fail on any attempt to reach the network.

Run with:  python3 -m unittest discover -s tests -v
"""

import contextlib
import csv
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import instaloader  # noqa: E402
from instaloader.exceptions import (  # noqa: E402
    ConnectionException,
    LoginRequiredException,
    QueryReturnedForbiddenException,
    TooManyRequestsException,
)

import backup_instagram as bi  # noqa: E402

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x11" * 300 + b"\xff\xd9"
MP4 = (
    (16).to_bytes(4, "big") + b"ftypisom" + b"\x00\x00\x02\x00"
    + (16).to_bytes(4, "big") + b"moov" + b"\x00" * 8
    + (108).to_bytes(4, "big") + b"mdat" + b"\x22" * 100
)
USERNAME = "friend"


class NetworkUsed(Exception):
    pass


def make_loader():
    loader = instaloader.Instaloader(sleep=False, quiet=True, max_connection_attempts=1)

    def no_network(*args, **kwargs):
        raise NetworkUsed("unexpected network access")

    for name in ("get_json", "doc_id_graphql_query", "graphql_query", "get_raw", "head", "get_iphone_json"):
        setattr(loader.context, name, no_network)
    return loader


def base_node(shortcode, ts, caption, typename, is_video, likes=10, comments=2, tagged=()):
    return {
        "__typename": typename,
        "id": str(abs(hash(shortcode)) % 10 ** 12),
        "shortcode": shortcode,
        "is_video": is_video,
        "taken_at_timestamp": ts,
        "display_url": f"https://cdn.test/{shortcode}.jpg?sig=1",
        "edge_media_to_caption": {"edges": [{"node": {"text": caption}}] if caption else []},
        "edge_media_preview_like": {"count": likes},
        "edge_media_to_comment": {"count": comments},
        "edge_media_to_tagged_user": {"edges": [{"node": {"user": {"username": u}}} for u in tagged]},
    }


def image_node(shortcode, ts, caption="A photo #Sunset #sunset @buddy", **kw):
    return base_node(shortcode, ts, caption, "GraphImage", False, **kw)


def video_node(shortcode, ts, caption="A reel", product_type="clips", **kw):
    node = base_node(shortcode, ts, caption, "GraphVideo", True, **kw)
    node["video_url"] = f"https://cdn.test/{shortcode}.mp4?sig=1"
    node["product_type"] = product_type
    return node


def carousel_node(shortcode, ts, caption="Carousel", **kw):
    node = base_node(shortcode, ts, caption, "GraphSidecar", False, **kw)
    node["edge_sidecar_to_children"] = {"edges": [
        {"node": {"is_video": False, "display_url": f"https://cdn.test/{shortcode}-1.jpg?sig=1"}},
        {"node": {"is_video": True, "display_url": f"https://cdn.test/{shortcode}-2c.jpg?sig=1",
                  "video_url": f"https://cdn.test/{shortcode}-2.mp4?sig=1"}},
        {"node": {"is_video": False, "display_url": f"https://cdn.test/{shortcode}-3.jpg?sig=1"}},
    ]}
    return node


# 2023-05-01 12:34:56 UTC, 2022-03-04 05:06:07 UTC, 2021-01-02 03:04:05 UTC, 2020-06-07 08:09:10 UTC
T2023, T2022, T2021, T2020 = 1682944496, 1646370367, 1609556645, 1591517350


class FakeResponse:
    def __init__(self, body, content_type, fail_after=None):
        self.body = body
        self.headers = {"Content-Type": content_type, "Content-Length": str(len(body))}
        self.fail_after = fail_after

    def iter_content(self, chunk_size=1):
        for start in range(0, len(self.body), 64):
            if self.fail_after is not None and start >= self.fail_after:
                raise ConnectionException("connection reset")
            yield self.body[start:start + 64]

    def close(self):
        pass


class FakeFetcher:
    """Serves media by URL. `errors` maps URL -> exception (or list of exceptions, consumed in order)."""

    def __init__(self, errors=None):
        self.calls = []
        self.errors = dict(errors or {})

    def open(self, url):
        self.calls.append(url)
        error = self.errors.get(url)
        if isinstance(error, list):
            error = error.pop(0) if error else None
        if error is not None:
            raise error
        path = url.split("?")[0]
        if path.endswith(".mp4"):
            return FakeResponse(MP4, "video/mp4")
        return FakeResponse(JPEG, "image/jpeg")


class FakeProfile:
    def __init__(self, posts_factory, reels_factory=None, mediacount=None):
        self.username = USERNAME
        self.userid = 123
        self.full_name = "Friend Name 🌅"
        self.biography = "Bio line 1\nBio line 2"
        self.external_url = "https://example.com"
        self.followers = 1000
        self.followees = 100
        self.mediacount = mediacount
        self.is_private = False
        self.is_verified = False
        self.is_business_account = False
        self.business_category_name = None
        self.followed_by_viewer = False
        self.profile_pic_url = "https://cdn.test/profile.jpg?sig=1"
        self._posts_factory = posts_factory
        self._reels_factory = reels_factory

    def get_posts(self):
        return self._posts_factory()

    def get_reels(self):
        if self._reels_factory is None:
            return iter([])
        return self._reels_factory()


class BackupTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.root = self.base / USERNAME
        self.loader = make_loader()

    def tearDown(self):
        bi.setup_logging(None)
        self._tmp.cleanup()

    def posts(self, nodes):
        return [instaloader.Post(self.loader.context, node) for node in nodes]

    def run_backup(self, nodes, extra_args=(), fetcher=None, reels_nodes=None, from_shortcode=None,
                   posts_factory=None, reels_factory=None):
        fetcher = fetcher or FakeFetcher()
        if posts_factory is None:
            posts_factory = lambda: iter(self.posts(nodes))  # noqa: E731
        if reels_factory is None and reels_nodes is not None:
            reels_factory = lambda: iter(self.posts(reels_nodes))  # noqa: E731
        profile = FakeProfile(posts_factory, reels_factory, mediacount=len(nodes))
        args = bi.build_parser().parse_args([USERNAME, "--output", str(self.base), "--max-retries", "2",
                                             "--delay", "0", *extra_args])

        def default_from_shortcode(context, shortcode):
            raise NetworkUsed(f"unexpected Post.from_shortcode({shortcode})")

        out = io.StringIO()
        with mock.patch.object(instaloader.Profile, "from_username", return_value=profile), \
                mock.patch.object(instaloader.Post, "from_shortcode", side_effect=from_shortcode or default_from_shortcode), \
                contextlib.redirect_stdout(out):
            code = bi.run_backup(USERNAME, self.root, args, loader=self.loader, fetcher=fetcher, sleep=lambda s: None)
        self.loader = make_loader()  # a fresh loader for the next run, like a new process
        return code, out.getvalue(), fetcher

    def records(self):
        return {rec["shortcode"]: rec for _, rec, _ in bi.read_record_files(self.root / "metadata" / "posts")}

    def media(self, name):
        return self.root / "media" / name


class FullBackupTests(BackupTestCase):
    NODES = [
        video_node("Reel1", T2023, tagged=("pal",)),
        carousel_node("Caro2", T2022),
        image_node("Img3", T2021, likes=42, comments=7, tagged=("Buddy",)),
    ]

    def test_creates_complete_backup(self):
        code, out, fetcher = self.run_backup(self.NODES)
        self.assertEqual(code, 0, out)
        for name in ("media", "metadata", "posts.csv", "posts.json", "README.txt", "index.html", "errors.log"):
            self.assertTrue((self.root / name).exists(), name)

        # Deterministic names: YYYY-MM-DD_HH-MM-SS_SHORTCODE_NN.ext
        expected = [
            "2021-01-02_03-04-05_Img3_01.jpg",
            "2022-03-04_05-06-07_Caro2_01.jpg",
            "2022-03-04_05-06-07_Caro2_02.mp4",
            "2022-03-04_05-06-07_Caro2_02_cover.jpg",
            "2022-03-04_05-06-07_Caro2_03.jpg",
            "2023-05-01_12-34-56_Reel1_01.mp4",
            "2023-05-01_12-34-56_Reel1_01_cover.jpg",
        ]
        for name in expected:
            self.assertTrue(self.media(name).is_file(), name)
        self.assertEqual(int(self.media(expected[0]).stat().st_mtime), T2021)
        pics = list((self.root / "media").glob("profile_pic_*.jpg"))
        self.assertEqual(len(pics), 1)

        data = json.loads((self.root / "posts.json").read_text(encoding="utf-8"))
        posts = data["posts"]
        self.assertEqual([p["shortcode"] for p in posts], ["Img3", "Caro2", "Reel1"])  # chronological
        img = posts[0]
        self.assertEqual(img["url"], "https://www.instagram.com/p/Img3/")
        self.assertEqual(img["date_utc"], "2021-01-02T03:04:05Z")
        self.assertEqual(img["media_type"], "image")
        self.assertEqual(img["likes"], 42)
        self.assertEqual(img["comments"], 7)
        self.assertEqual(img["hashtags"], ["Sunset"])  # original case, de-duplicated
        self.assertEqual(img["mentions"], ["buddy"])
        self.assertEqual(img["tagged_users"], ["buddy"])
        self.assertEqual(img["media_files"], ["2021-01-02_03-04-05_Img3_01.jpg"])
        self.assertEqual(posts[1]["media_type"], "carousel")
        self.assertEqual(len(posts[1]["media"]), 3)
        self.assertEqual(posts[2]["media_type"], "reel")
        self.assertTrue(all(p["status"] == "complete" for p in posts))
        self.assertEqual(data["profile"]["full_name"], "Friend Name 🌅")

        with open(self.root / "posts.csv", encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.DictReader(fh))
        self.assertEqual([r["shortcode"] for r in rows], ["Img3", "Caro2", "Reel1"])
        self.assertEqual(rows[1]["media_files"].split(";"), [
            "2022-03-04_05-06-07_Caro2_01.jpg", "2022-03-04_05-06-07_Caro2_02.mp4",
            "2022-03-04_05-06-07_Caro2_02_cover.jpg", "2022-03-04_05-06-07_Caro2_03.jpg"])

        self.assertTrue(list((self.root / "metadata" / "raw").glob("*_Img3.json.xz")))
        self.assertIn("Posts discovered:            3", out)
        self.assertIn("Images downloaded:           3", out)
        self.assertIn("Videos downloaded:           2", out)
        self.assertIn("[1/3] Downloading Reel1", out)
        self.assertIn("Download completed: Caro2 (2 images, 1 video)", out)
        html = (self.root / "index.html").read_text(encoding="utf-8")
        self.assertIn("2022-03-04_05-06-07_Caro2_02.mp4", html)
        self.assertEqual(bi.verify_backup(self.root).problem_count, 0)

    def test_rerun_skips_everything_and_keeps_files(self):
        self.run_backup(self.NODES)
        before = {p.name: (p.stat().st_ino, p.stat().st_mtime_ns) for p in (self.root / "media").iterdir()}
        code, out, fetcher = self.run_backup(self.NODES)
        self.assertEqual(code, 0, out)
        self.assertEqual(fetcher.calls, ["https://cdn.test/profile.jpg?sig=1"])  # only the profile picture check
        self.assertEqual(out.count("Already exists — skipped"), 3)
        self.assertIn("[2/3] Already exists — skipped: Caro2", out)
        self.assertIn("Profile picture: unchanged", out)
        after = {p.name: (p.stat().st_ino, p.stat().st_mtime_ns) for p in (self.root / "media").iterdir()}
        self.assertEqual(before, after)

    def test_zero_byte_or_missing_file_is_downloaded_again(self):
        self.run_backup(self.NODES)
        self.media("2022-03-04_05-06-07_Caro2_03.jpg").write_bytes(b"")
        self.media("2023-05-01_12-34-56_Reel1_01.mp4").unlink()
        untouched = self.media("2022-03-04_05-06-07_Caro2_01.jpg").stat().st_ino
        code, out, fetcher = self.run_backup(self.NODES)
        self.assertEqual(code, 0, out)
        media_calls = [u for u in fetcher.calls if "profile" not in u]
        self.assertEqual(sorted(media_calls), ["https://cdn.test/Caro2-3.jpg?sig=1", "https://cdn.test/Reel1.mp4?sig=1"])
        self.assertEqual(self.media("2022-03-04_05-06-07_Caro2_03.jpg").read_bytes(), JPEG)
        self.assertEqual(self.media("2022-03-04_05-06-07_Caro2_01.jpg").stat().st_ino, untouched)

    def test_verify_reports_problems(self):
        self.run_backup(self.NODES)
        self.media("2021-01-02_03-04-05_Img3_01.jpg").unlink()  # missing file
        self.media("2022-03-04_05-06-07_Caro2_01.jpg").write_bytes(JPEG[:100])  # truncated JPEG
        self.media("2022-03-04_05-06-07_Caro2_02.mp4").write_bytes(b"")  # zero-byte
        self.media("2023-05-01_12-34-56_Reel1_01.mp4").write_bytes(MP4[:40])  # truncated MP4
        data = json.loads((self.root / "posts.json").read_text(encoding="utf-8"))
        data["posts"].append(dict(data["posts"][0]))  # duplicated shortcode
        (self.root / "posts.json").write_text(json.dumps(data), encoding="utf-8")
        record_file = next((self.root / "metadata" / "posts").glob("*_Img3.json"))
        (record_file.parent / "copy_of_Img3.json").write_text(record_file.read_text(encoding="utf-8"), encoding="utf-8")
        (self.root / "media" / "leftover.jpg.part").write_bytes(b"x")

        report = bi.verify_backup(self.root)
        self.assertEqual(report.missing_files, ["Img3: media/2021-01-02_03-04-05_Img3_01.jpg"])
        corrupted = "\n".join(report.corrupted)
        self.assertIn("Caro2_01.jpg (Caro2): truncated JPEG", corrupted)
        self.assertIn("Caro2_02.mp4 (Caro2): zero-byte file", corrupted)
        self.assertIn("Reel1_01.mp4 (Reel1): truncated video", corrupted)
        duplicates = "\n".join(report.duplicates)
        self.assertIn("Img3: listed 2 times in posts.json", duplicates)
        self.assertIn("Img3: 2 records in metadata/posts", duplicates)
        self.assertEqual(report.leftovers, ["media/leftover.jpg.part"])

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = bi.main([USERNAME, "--output", str(self.base), "--verify"])
        self.assertEqual(code, 1)
        self.assertIn("Records referencing missing files: 1", out.getvalue())

        # A normal run repairs the media and regenerates posts.json.
        (record_file.parent / "copy_of_Img3.json").unlink()
        self.run_backup(self.NODES)
        report = bi.verify_backup(self.root)
        self.assertEqual(report.problem_count, 0, report)


class ResilienceTests(BackupTestCase):
    def test_failed_post_does_not_stop_backup_and_is_retried(self):
        nodes = [image_node("Good1", T2023), image_node("Bad2", T2022), image_node("Good3", T2021)]
        failing = FakeFetcher({"https://cdn.test/Bad2.jpg?sig=1": ConnectionException("connection reset by peer")})
        code, out, _ = self.run_backup(nodes, fetcher=failing)
        self.assertEqual(code, 1, out)
        recs = self.records()
        self.assertEqual(recs["Good1"]["status"], "complete")
        self.assertEqual(recs["Good3"]["status"], "complete")
        self.assertEqual(recs["Bad2"]["status"], "failed")
        self.assertEqual(recs["Bad2"]["caption"], "A photo #Sunset #sunset @buddy")  # metadata kept anyway
        self.assertIn("Failed:                      1", out)
        log_text = (self.root / "errors.log").read_text(encoding="utf-8")
        self.assertIn("Bad2", log_text)
        self.assertIn("connection reset by peer", log_text)

        code, out, fetcher = self.run_backup(nodes)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.records()["Bad2"]["status"], "complete")
        self.assertEqual([u for u in fetcher.calls if "profile" not in u], ["https://cdn.test/Bad2.jpg?sig=1"])

    def test_transient_error_is_retried_with_backoff(self):
        nodes = [image_node("Flaky1", T2023)]
        fetcher = FakeFetcher({"https://cdn.test/Flaky1.jpg?sig=1": [ConnectionException("timeout")]})
        code, out, _ = self.run_backup(nodes, fetcher=fetcher)
        self.assertEqual(code, 0, out)
        self.assertIn("failed (attempt 1/2)", out)
        self.assertEqual(self.records()["Flaky1"]["status"], "complete")

    def test_truncated_transfer_is_never_saved(self):
        nodes = [image_node("Cut1", T2023)]
        fetcher = FakeFetcher()
        original_open = fetcher.open
        attempts = []

        def open_truncated_once(url):
            if "Cut1" in url and not attempts:
                attempts.append(url)
                return FakeResponse(JPEG, "image/jpeg", fail_after=128)
            return original_open(url)

        fetcher.open = open_truncated_once
        code, out, _ = self.run_backup(nodes, fetcher=fetcher)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.media("2023-05-01_12-34-56_Cut1_01.jpg").read_bytes(), JPEG)
        self.assertEqual(list((self.root / "media").glob("*.part")), [])

    def test_rate_limit_stops_the_run_cleanly(self):
        nodes = [image_node("A1", T2023), image_node("B2", T2022)]
        fetcher = FakeFetcher({"https://cdn.test/A1.jpg?sig=1": TooManyRequestsException("429 Too Many Requests")})
        code, out, _ = self.run_backup(nodes, fetcher=fetcher)
        self.assertEqual(code, bi.EXIT_STOPPED, out)
        self.assertIn("rate-limiting", out)
        self.assertNotIn("B2", self.records())  # stopped instead of hammering Instagram
        self.assertTrue((self.root / "posts.json").exists())  # outputs are still written

    def test_expired_media_url_reloads_the_post(self):
        nodes = [image_node("Old1", T2023)]
        fetcher = FakeFetcher({"https://cdn.test/Old1.jpg?sig=1": QueryReturnedForbiddenException("403 Forbidden")})
        fresh = dict(image_node("Old1", T2023))
        fresh["display_url"] = "https://cdn.test/Old1.jpg?sig=2"
        code, out, _ = self.run_backup(
            nodes, fetcher=fetcher,
            from_shortcode=lambda context, shortcode: instaloader.Post(context, fresh))
        self.assertEqual(code, 0, out)
        self.assertIn("reloading the post", out)
        self.assertEqual(fetcher.calls[-1], "https://cdn.test/Old1.jpg?sig=2")
        self.assertEqual(self.records()["Old1"]["status"], "complete")

    def test_interrupt_and_resume_with_saved_position(self):
        nodes = [image_node("P1", T2023), image_node("P2", T2022), image_node("P3", T2021)]

        def node_iterator():
            context = self.loader.context
            return instaloader.NodeIterator(
                context, None, lambda d: d, lambda n: instaloader.Post(context, n),
                query_variables={"id": "123"}, query_referer=f"https://www.instagram.com/{USERNAME}/",
                first_data={"count": 3, "edges": [{"node": n} for n in nodes],
                            "page_info": {"has_next_page": False, "end_cursor": None}},
                doc_id="1234")

        fetcher = FakeFetcher({"https://cdn.test/P2.jpg?sig=1": KeyboardInterrupt()})
        code, out, _ = self.run_backup(nodes, fetcher=fetcher, posts_factory=node_iterator)
        self.assertEqual(code, bi.EXIT_INTERRUPTED, out)
        self.assertEqual(len(list((self.root / "metadata").glob("resume_posts_*.json.xz"))), 1)
        self.assertEqual(self.records()["P1"]["status"], "complete")
        self.assertNotEqual(self.records()["P2"]["status"], "complete")
        self.assertFalse((self.root / "metadata" / "backup.lock").exists())

        code, out, fetcher = self.run_backup(nodes, posts_factory=node_iterator)
        self.assertEqual(code, 0, out)
        self.assertIn("Continuing the posts scan at item 2", out)
        self.assertNotIn("P1", out)  # resumed after the finished post
        self.assertEqual({r["status"] for r in self.records().values()}, {"complete"})
        self.assertEqual(list((self.root / "metadata").glob("resume_*")), [])

    def test_consecutive_failures_stop_the_run(self):
        nodes = [image_node(f"N{i}", T2023 - i) for i in range(8)]
        errors = {f"https://cdn.test/N{i}.jpg?sig=1": ConnectionException("network is unreachable") for i in range(8)}
        code, out, _ = self.run_backup(nodes, fetcher=FakeFetcher(errors))
        self.assertEqual(code, bi.EXIT_STOPPED, out)
        self.assertIn("posts in a row failed", out)
        self.assertEqual(len(self.records()), bi.CONSECUTIVE_FAILURE_LIMIT)

    def test_second_run_is_refused_while_first_is_running(self):
        (self.root / "metadata").mkdir(parents=True)
        (self.root / "metadata" / "backup.lock").write_text(str(os.getppid()))
        code, out, fetcher = self.run_backup([image_node("X1", T2023)])
        self.assertEqual(code, bi.EXIT_LOCKED, out)
        self.assertEqual(fetcher.calls, [])

    def test_stale_lock_is_taken_over(self):
        (self.root / "metadata").mkdir(parents=True)
        (self.root / "metadata" / "backup.lock").write_text("999999999")
        code, out, _ = self.run_backup([image_node("X1", T2023)])
        self.assertEqual(code, 0, out)


class OptionTests(BackupTestCase):
    def test_since_until_and_pinned_posts(self):
        nodes = [
            image_node("Pinned0", T2020),  # old pinned post shown first
            image_node("New2023", T2023),
            image_node("Mid2022", T2022),
            image_node("Mid2021", T2021),
            image_node("Old2020", T2020 - 100),
        ]
        code, out, _ = self.run_backup(nodes, ["--since", "2021-01-01", "--until", "2022-12-31"])
        self.assertEqual(code, 0, out)
        self.assertEqual(sorted(self.records()), ["Mid2021", "Mid2022"])
        self.assertIn("Reached posts older than --since", out)

    def test_until_is_inclusive(self):
        nodes = [image_node("Day", T2022)]  # 2022-03-04
        self.run_backup(nodes, ["--until", "2022-03-04"])
        self.assertIn("Day", self.records())

    def test_metadata_only_then_full_run(self):
        nodes = [carousel_node("Caro", T2022)]
        code, out, fetcher = self.run_backup(nodes, ["--metadata-only"])
        self.assertEqual(code, 0, out)
        self.assertEqual(fetcher.calls, [])
        rec = self.records()["Caro"]
        self.assertEqual(rec["status"], "metadata_only")
        self.assertEqual(rec["media_files"], [])
        self.assertEqual(len(rec["media"]), 3)
        self.assertEqual(list((self.root / "media").iterdir()), [])

        code, out, _ = self.run_backup(nodes)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.records()["Caro"]["status"], "complete")
        self.assertEqual(len(self.records()["Caro"]["media_files"]), 4)

    def test_original_caption_is_kept_when_edited_later(self):
        self.run_backup([image_node("Cap", T2023, caption="Original caption")])
        self.media("2023-05-01_12-34-56_Cap_01.jpg").unlink()  # forces the post to be processed again
        code, out, _ = self.run_backup([image_node("Cap", T2023, caption="Edited by someone else")])
        self.assertEqual(code, 0, out)
        rec = self.records()["Cap"]
        self.assertEqual(rec["caption"], "Original caption")
        self.assertEqual(rec["caption_latest"], "Edited by someone else")

    def test_no_html(self):
        self.run_backup([image_node("A", T2023)], ["--no-html"])
        self.assertFalse((self.root / "index.html").exists())

    def test_reels_tab_is_deduplicated(self):
        grid = [video_node("Both", T2023), image_node("Img", T2022)]
        reels = [video_node("Both", T2023), video_node("OnlyReel", T2021, product_type=None)]
        code, out, fetcher = self.run_backup(grid, reels_nodes=reels)
        self.assertEqual(code, 0, out)
        recs = self.records()
        self.assertEqual(recs["Both"]["sources"], ["posts", "reels"])
        self.assertEqual(recs["OnlyReel"]["media_type"], "reel")
        self.assertEqual(fetcher.calls.count("https://cdn.test/Both.mp4?sig=1"), 1)

    def test_no_reels_option(self):
        code, out, _ = self.run_backup([image_node("A", T2023)], ["--no-reels"],
                                       reels_factory=lambda: self.fail("reels scanned"))
        self.assertEqual(code, 0, out)

    def test_reels_tab_needing_login_is_not_fatal(self):
        def reels_blocked():
            raise LoginRequiredException("Redirected to login page.")

        code, out, _ = self.run_backup([image_node("A", T2023)], reels_factory=reels_blocked)
        self.assertEqual(code, 0, out)
        self.assertIn("Reels tab is not accessible", out)

    def test_changed_profile_picture_keeps_old_one(self):
        self.run_backup([image_node("A", T2023)])
        fetcher = FakeFetcher()
        original_open = fetcher.open
        new_pic = JPEG[:-2] + b"\x99\xff\xd9"
        fetcher.open = lambda url: FakeResponse(new_pic, "image/jpeg") if "profile" in url else original_open(url)
        self.run_backup([image_node("A", T2023)], fetcher=fetcher)
        pics = sorted((self.root / "media").glob("profile_pic_*"))
        self.assertEqual(len(pics), 2)
        self.assertEqual({p.read_bytes() for p in pics}, {JPEG, new_pic})


class ProfileAccessTests(BackupTestCase):
    def test_private_profile_is_refused(self):
        def private_profile():
            profile = FakeProfile(lambda: self.fail("posts scanned"))
            profile.is_private = True
            return profile

        args = bi.build_parser().parse_args([USERNAME, "--delay", "0"])
        out = io.StringIO()
        with mock.patch.object(instaloader.Profile, "from_username", return_value=private_profile()), \
                contextlib.redirect_stdout(out):
            code = bi.run_backup(USERNAME, self.root, args, loader=self.loader, fetcher=FakeFetcher(),
                                 sleep=lambda s: None)
        self.assertEqual(code, bi.EXIT_PROFILE)
        self.assertIn("private profile", out.getvalue())
        self.assertFalse((self.root / "metadata" / "backup.lock").exists())

    def test_missing_profile(self):
        args = bi.build_parser().parse_args([USERNAME, "--delay", "0"])
        out = io.StringIO()
        missing = instaloader.exceptions.ProfileNotExistsException("Profile friend does not exist.")
        with mock.patch.object(instaloader.Profile, "from_username", side_effect=missing), \
                contextlib.redirect_stdout(out):
            code = bi.run_backup(USERNAME, self.root, args, loader=self.loader, fetcher=FakeFetcher(),
                                 sleep=lambda s: None)
        self.assertEqual(code, bi.EXIT_PROFILE)
        self.assertIn("Profile not found", out.getvalue())

    def test_login_without_saved_session(self):
        with mock.patch.object(self.loader, "load_session_from_file", side_effect=FileNotFoundError()):
            code, out, fetcher = self.run_backup([image_node("A", T2023)], ["--login", "my_own_account"])
        self.assertEqual(code, bi.EXIT_USAGE)
        self.assertIn("instaloader --login my_own_account", out)
        self.assertEqual(fetcher.calls, [])

    def test_later_reels_scans_stop_at_known_reels(self):
        reels = [video_node(f"R{i}", T2023 - i * 1000) for i in range(12)]
        self.run_backup([], reels_nodes=reels)
        self.assertTrue(json.loads((self.root / "metadata" / "state.json").read_text())["reels_scan_completed_utc"])
        newest = [video_node("RNew", T2023 + 1000)]
        consumed = []

        def reels_factory():
            for node in newest + reels:
                consumed.append(node["shortcode"])
                yield instaloader.Post(self.loader.context, node)

        code, out, _ = self.run_backup([], reels_factory=reels_factory)
        self.assertEqual(code, 0, out)
        self.assertIn("RNew", self.records())
        self.assertIn("stopping the reels scan", out)
        self.assertEqual(len(consumed), 1 + bi.KNOWN_REELS_STOP)


class HelperTests(unittest.TestCase):
    def test_normalize_username(self):
        self.assertEqual(bi.normalize_username("Some.User"), "some.user")
        self.assertEqual(bi.normalize_username("@some_user"), "some_user")
        self.assertEqual(bi.normalize_username("https://www.instagram.com/some.user/?hl=en"), "some.user")
        for bad in ("", "a b", "name/x", "x" * 31):
            with self.assertRaises(ValueError):
                bi.normalize_username(bad)

    def test_media_problem(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            cases = {
                "ok.jpg": (JPEG, None),
                "ok.mp4": (MP4, None),
                "empty.jpg": (b"", "zero-byte"),
                "cut.jpg": (JPEG[:50], "truncated JPEG"),
                "cut.mp4": (MP4[:-10], "truncated video"),
                "nomoov.mp4": (MP4[:16] + (108).to_bytes(4, "big") + b"mdat" + b"\x00" * 100, "moov"),
                "page.jpg": (b"<!DOCTYPE html><html>error</html>", "unrecognized content"),
            }
            for name, (content, expected) in cases.items():
                (folder / name).write_bytes(content)
                problem = bi.media_problem(folder / name)
                if expected is None:
                    self.assertIsNone(problem, name)
                else:
                    self.assertIn(expected, problem or "", name)

    def test_gallery_escapes_script_content(self):
        rec = {"shortcode": "X", "url": "u", "date_utc": "2023-01-01T00:00:00Z", "media_type": "image",
               "caption": "</script><script>alert(1)</script> & <b>", "media": [], "status": "complete"}
        html = bi.render_gallery("friend", {}, [rec], None, "2023-01-01T00:00:00Z")
        self.assertNotIn("<script>alert(1)", html)
        self.assertEqual(html.count("</script>"), 2)  # data block + code block only
        data = html.split('type="application/json">')[1].split("</script>")[0]
        self.assertEqual(json.loads(data)["posts"][0]["caption"], rec["caption"])

    def test_csv_keeps_multiline_and_emoji_captions(self):
        caption = 'Line 1, with "quotes"\nLine 2 🌅; #tag'
        text = bi.build_csv([{"shortcode": "X", "caption": caption, "hashtags": ["tag"], "media": []}])
        row = next(csv.DictReader(io.StringIO(text)))
        self.assertEqual(row["caption"], caption)
        self.assertEqual(row["hashtags"], "tag")

    def test_retrier_does_not_retry_permanent_errors(self):
        calls = []

        def not_found():
            calls.append(1)
            raise instaloader.exceptions.QueryReturnedNotFoundException("404")

        with self.assertRaises(instaloader.exceptions.QueryReturnedNotFoundException):
            bi.Retrier(5, sleep=lambda s: None).call(not_found, "x")
        self.assertEqual(len(calls), 1)

    def test_retrier_backoff_grows(self):
        delays = []

        def always_fails():
            raise ConnectionException("temporary")

        with mock.patch.object(bi.random, "uniform", return_value=1.0), contextlib.redirect_stdout(io.StringIO()):
            bi.setup_logging(None)
            with self.assertRaises(ConnectionException):
                bi.Retrier(4, sleep=delays.append).call(always_fails, "x")
        self.assertEqual(delays, [15.0, 30.0, 60.0])


class CliTests(unittest.TestCase):
    def test_help(self):
        result = subprocess.run([sys.executable, str(HERE.parent / "backup_instagram.py"), "--help"],
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        for option in ("--output", "--no-reels", "--no-html", "--metadata-only", "--since", "--until", "--verify"):
            self.assertIn(option, result.stdout)

    def test_bad_arguments(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                bi.main(["friend", "--since", "2023-13-01"])
            self.assertEqual(ctx.exception.code, 2)
            with self.assertRaises(SystemExit):
                bi.main(["friend", "--since", "2024-01-01", "--until", "2023-01-01"])

    def test_verify_without_backup(self):
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(bi.main(["friend", "--output", tmp, "--verify"]), 2)


if __name__ == "__main__":
    unittest.main()
