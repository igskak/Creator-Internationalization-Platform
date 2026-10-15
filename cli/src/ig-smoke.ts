import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { createDb, isPoolerUrl, schema } from "@rc/db";
import { eq, or } from "@rc/db/orm";
import { EnvValidationError, loadServerEnv, runtimeDatabaseUrl } from "@rc/lib/env";
import { createLogger } from "@rc/lib/logging";
import { createStorage } from "@rc/lib/providers/storage";
import { createServiceContext, instagramRuntimeFromEnv } from "@rc/modules/core";
import { formatSmokeReport, makeSmokeSlides, runInstagramSmoke } from "@rc/modules/instagram";

// `pnpm ig:smoke --account <id|username> [--reel [--video f.mp4]] [--live] [--probe-republish]
// [--yes] [--out file]` (plan 13 §13.6, docs/runbooks/instagram-smoke.md, docs/runbooks/reels.md).
// Without --live nothing is posted.

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const account = value("account");
if (!account || flag("help")) {
  console.log(
    [
      "Usage: pnpm ig:smoke --account <social account id | username> [options]",
      "  --reel              try a Reel (REELS container from an mp4) instead of a carousel",
      "  --video <file>      with --reel: this mp4 instead of a synthetic 6 s clip (needs ffmpeg)",
      "  --live              post a real, public test post (needs INSTAGRAM_PUBLISH_MODE=live)",
      "  --probe-republish   after a live post, call media_publish again to learn what Meta answers (V-08)",
      "  --yes               do not ask for the confirmation of a live post",
      "  --out <file>        also write the report to a file",
    ].join("\n"),
  );
  process.exit(account ? 0 : 1);
}

const env = (() => {
  try {
    return loadServerEnv();
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    console.error(`ig:smoke: ${error.message}`);
    process.exit(1);
  }
})();

const url = runtimeDatabaseUrl(env.db, env.appEnv);
const { db, close } = createDb(url, { pooled: isPoolerUrl(url), max: 1 });
const ctx = createServiceContext({
  db,
  logger: createLogger({ service: "cli", env: env.appEnv, level: env.observability.logLevel }),
  storage: createStorage(env.storage),
  instagram: instagramRuntimeFromEnv(env),
  actor: { type: "SYSTEM" },
});

try {
  const bare = account.replace(/^@/, "");
  const isUuid = /^[0-9a-f-]{36}$/i.test(bare);
  const [row] = await db
    .select()
    .from(schema.socialAccounts)
    .where(
      isUuid
        ? or(eq(schema.socialAccounts.id, bare), eq(schema.socialAccounts.username, bare))
        : eq(schema.socialAccounts.username, bare),
    );
  if (!row) {
    console.error(
      `ig:smoke: no connected account "${account}". Connect it in Settings → Instagram.`,
    );
    process.exit(1);
  }

  if (flag("live") && !flag("yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const typed = await rl.question(
      `This posts a PUBLIC test post to @${row.username} (${env.appEnv}). Type the user name to continue: `,
    );
    rl.close();
    if (typed.trim().replace(/^@/, "") !== row.username) {
      console.error("ig:smoke: not confirmed, nothing was done.");
      process.exit(1);
    }
  }

  const videoFile = value("video");
  const video = flag("reel")
    ? new Uint8Array(videoFile ? readFileSync(videoFile) : makeSmokeVideo())
    : undefined;
  const report = await runInstagramSmoke(ctx, {
    socialAccountId: row.id,
    live: flag("live"),
    probeRepublish: flag("probe-republish"),
    slides: video ? [] : await makeSmokeSlides(3),
    ...(video ? { video } : {}),
  });
  const text = formatSmokeReport(report);
  console.log(text);
  const out = value("out");
  if (out) writeFileSync(out, `${text}\n`);
  process.exitCode = report.passed ? 0 : 1;
} finally {
  await close();
}

/**
 * A synthetic 6 s Reel: ffmpeg's test pattern at 1080 × 1920, 30 fps, H.264 High yuv420p, silent
 * AAC 48 kHz, moov atom first: the encoder profile of our renderer (18 §18.4), nothing of the brand.
 */
function makeSmokeVideo(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "ig-smoke-"));
  const out = join(dir, "smoke.mp4");
  try {
    execFileSync(
      "ffmpeg",
      [
        ["-hide_banner", "-loglevel", "error", "-y"],
        ["-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=6"],
        ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"],
        ["-t", "6", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p"],
        ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", out],
      ].flat(),
    );
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
