import { describe, expect, it } from "vitest";
import { boxFilter, buildFfmpegArgs } from "./ffmpeg";
import { buildAssemblyPlan, type PlanScene } from "./plan";

const scenes: PlanScene[] = [
  { id: "s1", beats: 4, card: "A", layout: "RIGHT" },
  { id: "s2", beats: 3, card: "B", layout: "FULL" },
];
const shots = { s1: { path: "/shots/1.mp4" }, s2: { path: "/shots/2.mp4", trimStartSeconds: 0.5 } };
const cardPaths = { s1: "/cards/s1.png", s2: "/cards/s2.png" };
const plan = buildAssemblyPlan(scenes, shots, { flashOpener: false });
const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1] ?? "";

describe("boxFilter", () => {
  it("puts the picture in a 907 × 1613 box flush right on white", () => {
    const f = boxFilter("RIGHT");
    expect(f).toContain("scale=907:1613:force_original_aspect_ratio=decrease");
    expect(f).toContain("pad=1080:1920:173+(907-iw)/2:307+(1613-ih)/2:white");
  });

  it("fills the frame for a full-bleed picture", () => {
    expect(boxFilter("FULL")).toBe(
      "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920",
    );
  });
});

describe("buildFfmpegArgs", () => {
  const args = buildFfmpegArgs(plan, { cardPaths, outPath: "/out/reel.mp4" });
  const graph = graphOf(args);

  it("takes a clip and a looped card per segment, then a silent track without audio", () => {
    expect(args.filter((a) => a === "-i")).toHaveLength(5);
    expect(args).toContain("/shots/1.mp4");
    expect(args).toContain("/cards/s2.png");
    expect(args.join(" ")).toContain("-f lavfi -t 3.5 -i anullsrc=r=44100:cl=stereo");
    expect(args[args.indexOf("-map") + 1]).toBe("[v]");
    expect(args.join(" ")).toContain("-map 4:a");
  });

  it("builds the graph of each segment: cut, lift to white, box, card with a fade, hard cut", () => {
    expect(graph).toContain(
      "[0:v]trim=start=0:duration=2,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=2",
    );
    expect(graph).toContain("[2:v]trim=start=0.5:duration=1.5");
    expect(graph).toContain("colorlevels=rimax=0.9:gimax=0.9:bimax=0.9");
    expect(graph).toContain("[1:v]format=rgba,fade=in:st=0:d=0.12:alpha=1[c0]");
    expect(graph).toContain("[b0][c0]overlay=0:0:format=auto");
    expect(graph).toContain("[s0][s1]concat=n=2:v=1:a=0[v]");
    expect(graph).not.toContain("xfade");
  });

  it("encodes H.264 High, yuv420p, 30 fps, AAC, faststart", () => {
    const text = args.join(" ");
    for (const part of [
      "-c:v libx264",
      "-profile:v high",
      "-pix_fmt yuv420p",
      "-r 30",
      "-c:a aac",
      "-movflags +faststart",
      "-crf 18",
    ]) {
      expect(text).toContain(part);
    }
    expect(args.at(-1)).toBe("/out/reel.mp4");
  });

  it("uses the given audio instead of silence, and a test CRF and preset", () => {
    const withAudio = buildFfmpegArgs(plan, {
      cardPaths,
      outPath: "/o.mp4",
      audio: { path: "/audio/beat.wav" },
      crf: 10,
      preset: "ultrafast",
    });
    const text = withAudio.join(" ");
    expect(text).toContain("-i /audio/beat.wav");
    expect(text).not.toContain("anullsrc");
    expect(text).toContain("-crf 10");
    expect(text).toContain("-preset ultrafast");
  });

  it("needs the card of every scene", () => {
    expect(() => buildFfmpegArgs(plan, { cardPaths: { s1: "/c.png" }, outPath: "/o.mp4" })).toThrow(
      "No card for scene s2",
    );
  });

  it("shows the hook card on the flash slices", () => {
    const flashScenes: PlanScene[] = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i + 1}`,
      beats: 3,
      card: `C${i}`,
      layout: "RIGHT" as const,
    }));
    const allShots = Object.fromEntries(flashScenes.map((s) => [s.id, { path: `/${s.id}.mp4` }]));
    const cards = Object.fromEntries(flashScenes.map((s) => [s.id, `/cards/${s.id}.png`]));
    const withFlash = buildFfmpegArgs(
      buildAssemblyPlan(flashScenes, allShots, { flashOpener: true }),
      { cardPaths: cards, outPath: "/o.mp4" },
    );
    expect(withFlash.filter((a) => a === "/cards/s1.png")).toHaveLength(5);
    expect(graphOf(withFlash)).toContain("concat=n=10:v=1:a=0[v]");
  });
});
