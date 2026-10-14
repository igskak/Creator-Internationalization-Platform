import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { beatDurationSeconds, beatSchedule, SAMPLE_RATE, synthesizeBeat } from "./beat";

// The same seven scenes as the synthetic posts: 4 + 3 + 4 + 4 + 5 + 4 + 4 beats, the peak at scene 5.
const BEATS = [4, 3, 4, 4, 5, 4, 4];
const input = { sceneBeats: BEATS, flashSeconds: 0.88, peakSceneIndex: 4 };

describe("beatDurationSeconds", () => {
  it("is the flash opener plus the scenes, exactly the length of the video", () => {
    expect(beatDurationSeconds(input)).toBe(14.88);
    expect(beatDurationSeconds({ ...input, flashSeconds: 0 })).toBe(14);
    expect(beatDurationSeconds({ sceneBeats: [3.5, 3], flashSeconds: 0 })).toBe(3.25);
  });
});

describe("beatSchedule", () => {
  const at = (kind: string) =>
    beatSchedule(input)
      .filter((e) => e.kind === kind)
      .map((e) => e.time);
  const near = (a: number[], b: number[]) => {
    expect(a).toHaveLength(b.length);
    for (const [i, x] of a.entries()) expect(x).toBeCloseTo(b[i] ?? 0, 6);
  };

  it("puts a pop on every cut after the first scene, after the flash opener", () => {
    // Scene starts in beats: 0, 4, 7, 11, 15, 20, 24.
    near(
      at("pop"),
      [4, 7, 11, 15, 20, 24].map((b) => 0.88 + b * 0.5),
    );
  });

  it("keeps the hook scene to hats and a bass pulse, and brings kick and clap in with the second scene", () => {
    const firstCut = 0.88 + 4 * 0.5;
    expect(at("kick").every((t) => t >= firstCut - 1e-9)).toBe(true);
    expect(at("kick")[0]).toBeCloseTo(firstCut, 6);
    // A kick on every beat from there to the end: 24 beats.
    expect(at("kick")).toHaveLength(24);
    // The clap is on the odd beats only.
    expect(at("clap")).toHaveLength(12);
    expect(
      beatSchedule(input)
        .filter((e) => e.kind === "bass" && e.time < firstCut)
        .every((e) => e.length === 0.3),
    ).toBe(true);
  });

  it("lands the impact just before the peak scene and a riser at the start", () => {
    near(at("boom"), [0.88 + 15 * 0.5 - 0.02]);
    near(at("riser"), [0]);
    expect(beatSchedule(input).find((e) => e.kind === "riser")?.param).toBe(0.88);
  });

  it("has no riser without a flash opener and no impact without a peak scene", () => {
    const plain = beatSchedule({ sceneBeats: BEATS, flashSeconds: 0 });
    expect(plain.some((e) => e.kind === "riser" || e.kind === "boom")).toBe(false);
    expect(plain.find((e) => e.kind === "kick")?.time).toBe(2);
  });

  it("is sorted by time and stays inside the audio", () => {
    const events = beatSchedule(input);
    expect(events.map((e) => e.time)).toEqual([...events.map((e) => e.time)].sort((a, b) => a - b));
    expect(Math.max(...events.map((e) => e.time))).toBeLessThan(beatDurationSeconds(input));
  });
});

describe("synthesizeBeat", () => {
  const beat = synthesizeBeat(input);

  it("makes a mono 16-bit WAV of the right length", () => {
    const view = new DataView(beat.wav.buffer, beat.wav.byteOffset, beat.wav.byteLength);
    const text = (o: number, n: number) => String.fromCharCode(...beat.wav.slice(o, o + n));
    expect([text(0, 4), text(8, 4), text(12, 4), text(36, 4)]).toEqual([
      "RIFF",
      "WAVE",
      "fmt ",
      "data",
    ]);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    const samples = view.getUint32(40, true) / 2;
    expect(samples).toBe(Math.floor(14.88 * SAMPLE_RATE));
    expect(beat.durationSeconds).toBe(14.88);
  });

  it("is the same file every time", () => {
    expect(synthesizeBeat(input).wav).toEqual(beat.wav);
    expect(synthesizeBeat({ ...input, flashSeconds: 0 }).wav).not.toEqual(beat.wav);
  });

  it("stays under the peak limit with a usable level, and ends in silence", () => {
    // −1.4 dBFS at most, so no clipping; a mean level a viewer can hear on a phone.
    expect(beat.peakDb).toBeLessThanOrEqual(-1.3);
    expect(beat.peakDb).toBeGreaterThan(-1.6);
    expect(beat.rmsDb).toBeGreaterThan(-16);
    expect(beat.rmsDb).toBeLessThan(-10);
    const view = new DataView(beat.wav.buffer, beat.wav.byteOffset, beat.wav.byteLength);
    const n = (beat.wav.byteLength - 44) / 2;
    expect(Math.abs(view.getInt16(44 + (n - 1) * 2, true))).toBeLessThan(200);
  });

  it("refuses a Reel with no scenes", () => {
    expect(() => synthesizeBeat({ sceneBeats: [], flashSeconds: 0 })).toThrow("needs scenes");
  });
});

const haveFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const tmp = mkdtempSync(join(tmpdir(), "beat-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(!haveFfmpeg)("the beat as ffmpeg measures it", () => {
  it("is loud enough for a phone and does not clip", () => {
    const wav = join(tmp, "beat.wav");
    writeFileSync(wav, synthesizeBeat(input).wav);
    const run = spawnSync(
      "ffmpeg",
      ["-hide_banner", "-nostats", "-i", wav, "-af", "ebur128=peak=true", "-f", "null", "-"],
      { encoding: "utf8" },
    );
    const summary = run.stderr.slice(run.stderr.lastIndexOf("Summary:"));
    const integrated = Number(/I:\s+(-?[\d.]+) LUFS/u.exec(summary)?.[1]);
    const truePeak = Number(/Peak:\s+(-?[\d.]+) dBFS/u.exec(summary)?.[1]);
    // The feed plays around −14 LUFS; the beat sits at about −15 and keeps its true peak under −1 dBTP.
    expect(integrated).toBeGreaterThan(-17.5);
    expect(integrated).toBeLessThan(-13);
    expect(truePeak).toBeLessThanOrEqual(-1);
  });
});
