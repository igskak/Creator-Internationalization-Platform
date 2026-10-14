import type { ReelQaReport } from "@rc/db/json";
import type { CardMeasure } from "./cards";
import { FPS, HEIGHT, MAX_SECONDS, WIDTH } from "./constants";
import type { Exec } from "./exec";

// Deterministic checks of a finished Reel (plan 18 §18.4 step 4): format, black frames, motion in
// the first second, text cards inside the safe zone. The parsers are pure; `probeReel` runs
// ffprobe and ffmpeg.

/** Mean luma difference between consecutive frames in the first second; below it the opening is still. Provisional, tune on real Reels. */
export const MIN_FIRST_SECOND_MOTION = 0.1;
/** Black frames are a note, not a failure: a dark picture is allowed, a black screen is not. */
export const MAX_BLACK_FRAMES = 3;

export type Probe = {
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  bytes: number;
  fps: number | null;
};

type ProbeJson = {
  format?: { duration?: string; size?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
  }[];
};

export function parseProbe(json: string): Probe {
  const data = JSON.parse(json) as ProbeJson;
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("The file has no video stream.");
  const [n, d] = (video.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    durationMs: Math.round(Number(data.format?.duration ?? 0) * 1000),
    width: video.width ?? 0,
    height: video.height ?? 0,
    videoCodec: video.codec_name ?? "",
    audioCodec: audio?.codec_name ?? null,
    bytes: Number(data.format?.size ?? 0),
    fps: n && d ? n / d : null,
  };
}

/** Frames inside black stretches, from the `blackdetect` lines of ffmpeg's log. */
export function parseBlackFrames(log: string, fps: number = FPS): number {
  let seconds = 0;
  for (const match of log.matchAll(/black_duration:\s*([\d.]+)/gu)) seconds += Number(match[1]);
  return Math.round(seconds * fps);
}

/** Mean of the `signalstats` YAVG values printed for the frame differences. */
export function parseMotion(log: string): number {
  const values = [...log.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/gu)].map((m) => Number(m[1]));
  if (values.length === 0) return 0;
  // The first frame has nothing to differ from.
  const used = values.length > 1 ? values.slice(1) : values;
  return Math.round((used.reduce((a, b) => a + b, 0) / used.length) * 1000) / 1000;
}

export function buildQaReport(parts: {
  probe: Probe;
  blackFrames: number;
  firstSecondMotion: number;
  cards: readonly CardMeasure[];
}): ReelQaReport {
  const { probe, blackFrames, firstSecondMotion, cards } = parts;
  const safeZoneOk = cards.every((c) => c.insideSafeZone);
  const warnings: string[] = [];
  if (probe.durationMs > MAX_SECONDS * 1000) warnings.push(`DURATION_OVER_${MAX_SECONDS}S`);
  if (probe.width !== WIDTH || probe.height !== HEIGHT) warnings.push("SIZE_NOT_1080X1920");
  if (probe.videoCodec !== "h264") warnings.push(`VIDEO_CODEC_${probe.videoCodec.toUpperCase()}`);
  if (probe.audioCodec === null) warnings.push("NO_AUDIO_TRACK");
  if (blackFrames > MAX_BLACK_FRAMES) warnings.push("BLACK_FRAMES");
  if (firstSecondMotion < MIN_FIRST_SECOND_MOTION) warnings.push("STATIC_OPENING");
  if (!safeZoneOk) warnings.push("CARD_OUTSIDE_SAFE_ZONE");
  if (cards.some((c) => c.belowMinimum)) warnings.push("CARD_FONT_BELOW_MINIMUM");
  return {
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    fileBytes: probe.bytes,
    blackFrames,
    safeZoneOk,
    firstSecondMotion,
    warnings,
  };
}

export async function probeReel(
  path: string,
  tools: { exec: Exec; ffmpeg: string; ffprobe: string },
  cards: readonly CardMeasure[],
): Promise<{ probe: Probe; qa: ReelQaReport }> {
  const { exec, ffmpeg, ffprobe } = tools;
  const info = await exec(ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    path,
  ]);
  const probe = parseProbe(info.stdout);
  const black = await exec(ffmpeg, [
    "-hide_banner",
    "-nostats",
    "-i",
    path,
    "-vf",
    "blackdetect=d=0.05:pix_th=0.1",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const motion = await exec(ffmpeg, [
    "-hide_banner",
    "-nostats",
    "-t",
    "1",
    "-i",
    path,
    "-vf",
    "tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const qa = buildQaReport({
    probe,
    blackFrames: parseBlackFrames(black.stderr, probe.fps ?? FPS),
    firstSecondMotion: parseMotion(`${motion.stderr}\n${motion.stdout}`),
    cards,
  });
  return { probe, qa };
}
