import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comparePng } from "../../visuals/render/golden";
import { type AssembleInput, assembleReel, assemblyInputHash } from "./assemble";
import type { RenderedCard } from "./cards";

// Real ffmpeg on synthetic clips. The cards are flat rectangles drawn by sharp, so the golden
// frames do not depend on the platform's fonts; the cards of Chromium are tested in cards.test.ts.
// Update the golden frames with UPDATE_GOLDEN=1.

const haveFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, "__golden__");
const tmp = mkdtempSync(join(tmpdir(), "reel-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A 3 s grey-cast clip (#e6e6e6) with a coloured square that moves right. */
function makeClip(name: string, color: string): string {
  const out = join(tmp, `${name}.mp4`);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0xe6e6e6:s=720x1280:r=30:d=3",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=240x240:r=30:d=3`,
    "-filter_complex",
    "[0:v][1:v]overlay=x='60+120*t':y=520,format=yuv420p",
    "-c:v",
    "libx264",
    "-crf",
    "10",
    "-t",
    "3",
    out,
  ]);
  return out;
}

/** A flat dark card in the card position, one colour per scene; the fade makes it see-through at first. */
async function flatCard(card: string): Promise<RenderedCard> {
  const color = card === "A" ? "#111111" : card === "B" ? "#e1251b" : "#1b6be1";
  const rect = await sharp({ create: { width: 780, height: 260, channels: 4, background: color } })
    .png()
    .toBuffer();
  const png = await sharp({
    create: { width: 1080, height: 1920, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: rect, left: 70, top: 240 }])
    .png()
    .toBuffer();
  return {
    png: new Uint8Array(png),
    measure: {
      fontPx: 112,
      lines: 2,
      box: { x: 70, y: 240, width: 780, height: 260 },
      belowMinimum: false,
      insideSafeZone: true,
    },
  };
}

let clips: Record<string, string> = {};
beforeAll(() => {
  if (!haveFfmpeg) return;
  clips = {
    red: makeClip("red", "0xd2402d"),
    green: makeClip("green", "0x2da04b"),
    blue: makeClip("blue", "0x2d5fd2"),
  };
});

const scenes: AssembleInput["scenes"] = [
  { id: "s1", beats: 4, card: "A", layout: "RIGHT" },
  { id: "s2", beats: 3, card: "B", layout: "RIGHT" },
  { id: "s3", beats: 4, card: "C", layout: "FULL" },
  { id: "s4", beats: 4, card: "A", layout: "RIGHT" },
  { id: "s5", beats: 5, card: "B", layout: "RIGHT" },
  { id: "s6", beats: 3, card: "C", layout: "RIGHT" },
];
const input = (name: string, flashOpener: boolean): AssembleInput => ({
  scenes,
  shots: Object.fromEntries(
    scenes.map((s, i) => [
      s.id,
      { path: Object.values(clips)[i % 3] as string, sha256: `sha-${i % 3}` },
    ]),
  ),
  flashOpener,
  workDir: join(tmp, name),
  outPath: join(tmp, `${name}.mp4`),
});
const options = { cardRenderer: flatCard, crf: 10, preset: "ultrafast" };

async function frame(video: string, seconds: number): Promise<Uint8Array> {
  const out = join(tmp, `frame-${Math.round(seconds * 100)}.png`);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    String(seconds),
    "-i",
    video,
    "-frames:v",
    "1",
    "-vf",
    "scale=270:480:flags=area",
    out,
  ]);
  return new Uint8Array(readFileSync(out));
}

describe.skipIf(!haveFfmpeg)("assembleReel with ffmpeg", () => {
  it("makes a 1080 × 1920 H.264 + AAC file as long as the beats say, with a clean QA report", async () => {
    const reel = await assembleReel(input("plain", false), options);
    expect(reel).toMatchObject({ width: 1080, height: 1920, audioKind: "NONE" });
    expect(reel.qa).toMatchObject({
      videoCodec: "h264",
      audioCodec: "aac",
      safeZoneOk: true,
      blackFrames: 0,
    });
    expect(reel.qa.warnings).toEqual([]);
    // 23 beats = 11.5 s, within one frame.
    expect(Math.abs(reel.durationMs - 11_500)).toBeLessThan(80);
    expect(reel.plan.totalSeconds).toBe(11.5);
    expect(reel.qa.firstSecondMotion).toBeGreaterThan(0.1);
    expect(reel.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(reel.inputHash).toBe(assemblyInputHash(input("plain", false)));
    expect(existsSync(join(tmp, "plain", "cards", "s1.png"))).toBe(true);
  }, 120_000);

  it("adds the flash opener in front of the scenes", async () => {
    const reel = await assembleReel(input("flash", true), options);
    expect(Math.abs(reel.durationMs - (11_500 + 880))).toBeLessThan(120);
    expect(reel.plan.flashSeconds).toBeCloseTo(0.88, 3);
    expect(reel.inputHash).not.toBe(assemblyInputHash(input("plain", false)));
  }, 120_000);

  it("uses the audio it is given and records its kind", async () => {
    const audio = join(tmp, "beat.wav");
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-t",
      "12",
      "-i",
      "sine=f=440:r=44100",
      audio,
    ]);
    const reel = await assembleReel(
      {
        ...input("audio", false),
        audio: { path: audio, kind: "PLACEHOLDER_BEAT", sha256: "beat" },
      },
      options,
    );
    expect(reel.audioKind).toBe("PLACEHOLDER_BEAT");
    expect(reel.qa.audioCodec).toBe("aac");
    // The video is 11.5 s: the longer audio is cut at the end.
    expect(Math.abs(reel.durationMs - 11_500)).toBeLessThan(80);
  }, 120_000);

  it("matches the golden frames: box position, white lift, card fade, full-bleed scene", async () => {
    const reel = await assembleReel(input("golden", false), options);
    // Mid-scene frames: s1 (0–2 s), s2 (2–3.5 s), s3 FULL (3.5–5.5 s), s5 (7.5–9.75 s).
    const times: [string, number][] = [
      ["s1", 1.0],
      ["s2-fade", 2.05],
      ["s2", 3.0],
      ["s3-full", 4.5],
      ["s5", 8.5],
    ];
    for (const [name, t] of times) {
      const actual = await frame(reel.path, t);
      const file = join(GOLDEN, `${name}.png`);
      // biome-ignore lint/style/noProcessEnv: a test-only switch to rewrite the golden frames
      if (process.env.UPDATE_GOLDEN === "1") {
        mkdirSync(GOLDEN, { recursive: true });
        writeFileSync(file, actual);
        continue;
      }
      expect(existsSync(file), `missing golden ${name}.png (run with UPDATE_GOLDEN=1)`).toBe(true);
      const result = await comparePng(actual, new Uint8Array(readFileSync(file)));
      expect(result.ratio, `${name} differs in ${result.diffPixels} px`).toBeLessThan(0.004);
    }
  }, 120_000);

  it("keeps the clip background white inside the box (the grey cast is lifted)", async () => {
    const reel = await assembleReel(input("white", false), options);
    const { data, info } = await sharp(await frame(reel.path, 1.0))
      .raw()
      .toBuffer({ resolveWithObject: true });
    // A point in the box's lower right, away from the moving square and the card.
    const x = Math.round(info.width * 0.9);
    const y = Math.round(info.height * 0.9);
    const i = (y * info.width + x) * info.channels;
    expect([data[i], data[i + 1], data[i + 2]].every((v) => (v ?? 0) >= 250)).toBe(true);
  }, 120_000);
});
