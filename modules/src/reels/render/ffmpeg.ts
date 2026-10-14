import { BOX, ENCODER, FPS, HEIGHT, WHITE_LIFT, WIDTH } from "./constants";
import type { AssemblyPlan, Segment } from "./plan";

// The ffmpeg command of one Reel as a single filter graph: for every segment the clip is cut,
// lifted to white, placed in its box on a white frame and overlaid with the card's PNG; the
// segments are joined with hard cuts. Strings only (tested without ffmpeg); `assemble.ts` runs it.

const num = (n: number) => String(Math.round(n * 10_000) / 10_000);

/** The box filter of a layout: RIGHT = a 907 × 1613 box flush right on white; FULL = full bleed. */
export function boxFilter(layout: Segment["layout"]): string {
  if (layout === "FULL") {
    return `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${WIDTH}:${HEIGHT}`;
  }
  return (
    `scale=${BOX.width}:${BOX.height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
    `pad=${WIDTH}:${HEIGHT}:${BOX.left}+(${BOX.width}-iw)/2:${BOX.top}+(${BOX.height}-ih)/2:white`
  );
}

export type FfmpegInputs = {
  /** Path of the PNG of each scene's card, by scene id. */
  cardPaths: Readonly<Record<string, string>>;
  outPath: string;
  audio?: { path: string };
  /** Test hook: a lower CRF makes golden frames nearly exact. */
  crf?: number;
  preset?: string;
};

export function buildFfmpegArgs(plan: AssemblyPlan, inputs: FfmpegInputs): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  const graph: string[] = [];
  const joined: string[] = [];
  plan.segments.forEach((segment, i) => {
    const card = inputs.cardPaths[segment.cardSceneId];
    if (!card) throw new Error(`No card for scene ${segment.cardSceneId}.`);
    const clipIndex = 2 * i;
    const cardIndex = 2 * i + 1;
    const dur = num(segment.seconds);
    args.push(
      "-i",
      segment.clipPath,
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-t",
      dur,
      "-i",
      card,
    );
    graph.push(
      `[${clipIndex}:v]trim=start=${num(segment.trimStart)}:duration=${dur},setpts=PTS-STARTPTS,` +
        `tpad=stop_mode=clone:stop_duration=${dur},trim=duration=${dur},` +
        `colorlevels=rimax=${WHITE_LIFT}:gimax=${WHITE_LIFT}:bimax=${WHITE_LIFT},` +
        `${boxFilter(segment.layout)},fps=${FPS},setsar=1,format=yuv420p[b${i}]`,
      `[${cardIndex}:v]format=rgba,fade=in:st=0:d=${num(segment.fadeSeconds)}:alpha=1[c${i}]`,
      `[b${i}][c${i}]overlay=0:0:format=auto,trim=duration=${dur},setpts=PTS-STARTPTS,format=yuv420p[s${i}]`,
    );
    joined.push(`[s${i}]`);
  });
  graph.push(`${joined.join("")}concat=n=${plan.segments.length}:v=1:a=0[v]`);

  const audioIndex = plan.segments.length * 2;
  if (inputs.audio) args.push("-i", inputs.audio.path);
  else args.push("-f", "lavfi", "-t", num(plan.totalSeconds), "-i", "anullsrc=r=44100:cl=stereo");

  args.push(
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[v]",
    "-map",
    `${audioIndex}:a`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    inputs.preset ?? ENCODER.preset,
    "-crf",
    String(inputs.crf ?? ENCODER.crf),
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    ENCODER.audioBitrate,
    "-shortest",
    "-movflags",
    "+faststart",
    inputs.outPath,
  );
  return args;
}
