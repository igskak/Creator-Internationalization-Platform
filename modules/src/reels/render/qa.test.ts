import { describe, expect, it } from "vitest";
import type { CardMeasure } from "./cards";
import type { Exec } from "./exec";
import { buildQaReport, parseBlackFrames, parseMotion, parseProbe, probeReel } from "./qa";

const PROBE_JSON = JSON.stringify({
  format: { duration: "14.880000", size: "2345678" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1" },
    { codec_type: "audio", codec_name: "aac" },
  ],
});
const card = (over: Partial<CardMeasure> = {}): CardMeasure => ({
  fontPx: 112,
  lines: 2,
  box: { x: 70, y: 240, width: 700, height: 224 },
  belowMinimum: false,
  insideSafeZone: true,
  ...over,
});

describe("parsers", () => {
  it("reads the probe", () => {
    expect(parseProbe(PROBE_JSON)).toEqual({
      durationMs: 14_880,
      width: 1080,
      height: 1920,
      videoCodec: "h264",
      audioCodec: "aac",
      bytes: 2_345_678,
      fps: 30,
    });
    expect(
      parseProbe(
        JSON.stringify({ format: {}, streams: [{ codec_type: "video", codec_name: "h264" }] }),
      ).audioCodec,
    ).toBeNull();
    expect(() => parseProbe(JSON.stringify({ streams: [] }))).toThrow("no video stream");
  });

  it("counts the frames in black stretches", () => {
    const log =
      "[blackdetect @ 0x1] black_start:3 black_end:3.1 black_duration:0.1\n[blackdetect] black_start:9 black_end:9.2 black_duration:0.2";
    expect(parseBlackFrames(log, 30)).toBe(9);
    expect(parseBlackFrames("nothing", 30)).toBe(0);
  });

  it("averages the frame differences after the first frame", () => {
    const log = [
      "lavfi.signalstats.YAVG=0.0",
      "lavfi.signalstats.YAVG=2.0",
      "lavfi.signalstats.YAVG=4.0",
    ].join("\n");
    expect(parseMotion(log)).toBe(3);
    expect(parseMotion("")).toBe(0);
  });
});

describe("buildQaReport", () => {
  const probe = parseProbe(PROBE_JSON);

  it("passes a good Reel without warnings", () => {
    const qa = buildQaReport({ probe, blackFrames: 0, firstSecondMotion: 2, cards: [card()] });
    expect(qa).toMatchObject({
      safeZoneOk: true,
      warnings: [],
      width: 1080,
      height: 1920,
      durationMs: 14_880,
    });
  });

  it("warns, never throws, for each thing that is off", () => {
    const qa = buildQaReport({
      probe: { ...probe, durationMs: 31_000, width: 720, videoCodec: "vp9", audioCodec: null },
      blackFrames: 10,
      firstSecondMotion: 0,
      cards: [card({ insideSafeZone: false }), card({ belowMinimum: true })],
    });
    expect(qa.safeZoneOk).toBe(false);
    expect(qa.warnings).toEqual([
      "DURATION_OVER_30S",
      "SIZE_NOT_1080X1920",
      "VIDEO_CODEC_VP9",
      "NO_AUDIO_TRACK",
      "BLACK_FRAMES",
      "STATIC_OPENING",
      "CARD_OUTSIDE_SAFE_ZONE",
      "CARD_FONT_BELOW_MINIMUM",
    ]);
  });
});

describe("probeReel", () => {
  it("runs ffprobe, blackdetect and the motion check and builds the report", async () => {
    const calls: string[] = [];
    const exec: Exec = async (file, args) => {
      calls.push(`${file} ${args.join(" ")}`);
      if (file === "ffprobe") return { stdout: PROBE_JSON, stderr: "" };
      if (args.includes("blackdetect=d=0.05:pix_th=0.1")) return { stdout: "", stderr: "" };
      return { stdout: "", stderr: "lavfi.signalstats.YAVG=0\nlavfi.signalstats.YAVG=1.5" };
    };
    const { qa } = await probeReel("/o.mp4", { exec, ffmpeg: "ff", ffprobe: "ffprobe" }, [card()]);
    expect(calls).toHaveLength(3);
    expect(qa).toMatchObject({ blackFrames: 0, firstSecondMotion: 1.5, warnings: [] });
  });
});
