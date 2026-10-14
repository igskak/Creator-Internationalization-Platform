import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { createInterface } from "node:readline/promises";
import { EnvValidationError, loadServerEnv } from "@rc/lib/env";
import {
  createVideoProvider,
  DEFAULT_VIDEO_MODEL,
  estimateShotCostUsd,
  shotDurationRange,
  VIDEO_MODELS,
  type VideoModelId,
  type VideoResolution,
} from "@rc/lib/providers/video";

// `pnpm video:smoke [--image f] [--model m] [--seconds n] [--resolution r] [--prompt p] [--live]
// [--yes] [--out f.mp4]` (plan 18, M8-02). Without --live it only prints the estimate and whether
// the key is set; nothing is sent and nothing is spent.

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

if (flag("help")) {
  console.log(
    [
      "Usage: pnpm video:smoke [options]",
      `  --model <id>        one of ${VIDEO_MODELS.join(", ")} (default ${DEFAULT_VIDEO_MODEL})`,
      "  --seconds <n>       whole seconds (default 3)",
      "  --resolution <r>    480p | 720p | 1080p (default 720p)",
      "  --image <file>      the start picture, jpeg or png, prepared as 9:16 (needed with --live)",
      "  --prompt <text>     the shot prompt (default: a static-camera pour)",
      "  --live              really make one shot; needs AI_PROVIDER=live and HIGGSFIELD_API_KEY",
      "  --yes               do not ask for confirmation",
      "  --out <file.mp4>    where to save the clip (default video-smoke.mp4)",
    ].join("\n"),
  );
  process.exit(0);
}

const model = (value("model") ?? DEFAULT_VIDEO_MODEL) as VideoModelId;
if (!VIDEO_MODELS.includes(model)) {
  console.error(`video:smoke: unknown model ${model}`);
  process.exit(1);
}
const seconds = Number(value("seconds") ?? 3);
const resolution = (value("resolution") ?? "720p") as VideoResolution;
const range = shotDurationRange(model);
if (!Number.isInteger(seconds) || seconds < range.min || seconds > range.max) {
  console.error(`video:smoke: ${model} makes shots of ${range.min} to ${range.max} whole seconds.`);
  process.exit(1);
}

const env = (() => {
  try {
    return loadServerEnv();
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    console.error(`video:smoke: ${error.message}`);
    process.exit(1);
  }
})();

const estimate = estimateShotCostUsd(model, seconds, resolution);
const keySet = env.ai.provider === "live" && Boolean(env.ai.higgsfieldApiKey);
console.log(`model ${model}, ${seconds} s, ${resolution}: estimate about $${estimate.toFixed(2)}`);
console.log(
  `AI_PROVIDER=${env.ai.provider}, HIGGSFIELD_API_KEY ${keySet ? "is set" : "is not set"}`,
);

if (!flag("live")) {
  console.log("Dry run: nothing was sent. Add --live --image <file> to make one real shot.");
  process.exit(0);
}
if (!keySet) {
  console.error("video:smoke: --live needs AI_PROVIDER=live and HIGGSFIELD_API_KEY in .env.");
  process.exit(1);
}
const imagePath = value("image");
if (!imagePath) {
  console.error("video:smoke: --live needs --image <file>.");
  process.exit(1);
}
const mimeType = extname(imagePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";

if (!flag("yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Make one real shot (about $${estimate.toFixed(2)})? [y/N] `);
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("Cancelled.");
    process.exit(0);
  }
}

const provider = createVideoProvider(env.ai);
const prompt =
  value("prompt") ??
  "Static camera. A thin stream of golden oil keeps pouring into a bowl of grain, ripples spread. High-key studio light. No text, no people.";
const shot = await provider.generate({
  prompt,
  image: { bytes: new Uint8Array(readFileSync(imagePath)), mimeType },
  durationSeconds: seconds,
  resolution,
  model,
  idempotencyKey: `video-smoke:${Date.now()}`,
});
const out = value("out") ?? "video-smoke.mp4";
writeFileSync(out, shot.bytes);
console.log(
  `Saved ${out} (${shot.bytes.length} bytes, ${shot.width}x${shot.height}, request ${shot.providerRequestId}, list-price estimate $${shot.costUsd?.toFixed(2) ?? "?"}).`,
);
