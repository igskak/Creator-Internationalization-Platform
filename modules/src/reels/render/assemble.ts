import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReelAudioKind, ReelQaReport } from "@rc/db/json";
import type { Browser } from "playwright-core";
import { launchBrowser } from "../../visuals/render";
import { type CardMeasure, type RenderedCard, renderCard } from "./cards";
import { defaultExec, type Exec } from "./exec";
import { buildFfmpegArgs } from "./ffmpeg";
import { reelInputHash } from "./hash";
import { measureClipPageLevel } from "./page-level";
import { type AssemblyPlan, buildAssemblyPlan, type PlanScene, type PlanShot } from "./plan";
import { probeReel } from "./qa";

// Assembly of one Reel (plan 18 §18.4 step 3): the cards through Chromium, the cut list, one ffmpeg
// run, the checks. Local files in, a local file out: fetching shots from storage and storing the
// result belong to the generate service (M8-06).

export type AssembleShot = PlanShot & { sha256: string };

export type AssembleInput = {
  scenes: readonly PlanScene[];
  /** By scene id. */
  shots: Readonly<Record<string, AssembleShot>>;
  flashOpener: boolean;
  /** A sound file, or MODEL_AUDIO: the sound of the clips themselves (reel-director@4). */
  audio?:
    | { path: string; kind: Exclude<ReelAudioKind, "NONE" | "MODEL_AUDIO">; sha256: string }
    | { kind: "MODEL_AUDIO" };
  /** Folder for the card PNGs; created when missing. */
  workDir: string;
  outPath: string;
};

export type AssembleOptions = {
  exec?: Exec;
  ffmpegPath?: string;
  ffprobePath?: string;
  /** A browser that is already running (not closed here). */
  browser?: Browser;
  /** Test hooks: a lower CRF and a faster preset, and cards that are not drawn by Chromium. */
  crf?: number;
  preset?: string;
  cardRenderer?: (card: string, line?: string) => Promise<RenderedCard>;
};

export type AssembledReel = {
  path: string;
  inputHash: string;
  plan: AssemblyPlan;
  audioKind: ReelAudioKind;
  durationMs: number;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  qa: ReelQaReport;
  cards: Record<string, CardMeasure>;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** What ffprobe says about the first audio stream of a clip. */
export type ClipAudio = {
  codec: string;
  channels: number;
  /** ffprobe's layout name ("stereo", "5.1", "unknown"); empty when it has none. */
  layout: string;
  sampleRate: number;
};

/** The first audio stream of the clip; null when there is none or ffprobe cannot read the clip. */
export async function probeClipAudio(
  clipPath: string,
  tools: { exec: Exec; ffprobe: string },
): Promise<ClipAudio | null> {
  try {
    const { stdout } = await tools.exec(tools.ffprobe, [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=codec_name,channels,channel_layout,sample_rate",
      "-of",
      "json",
      clipPath,
    ]);
    const stream = (JSON.parse(stdout) as { streams?: Record<string, unknown>[] }).streams?.[0];
    if (!stream) return null;
    return {
      codec: String(stream.codec_name ?? "unknown"),
      channels: Number(stream.channels ?? 0),
      layout: String(stream.channel_layout ?? ""),
      sampleRate: Number(stream.sample_rate ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * The sound of a clip goes into the Reel only when it is mono or stereo: anything else (5.1, a
 * stream with no channels, an unknown layout of many channels) is replaced by silence, because the
 * graph cannot always fold it down.
 */
export const isUsableAudio = (audio: ClipAudio | null): boolean =>
  audio !== null && (audio.channels === 1 || audio.channels === 2) && audio.sampleRate > 0;

const describeAudio = (audio: ClipAudio | null): string =>
  audio
    ? `${audio.codec} ${audio.channels} ch, layout ${audio.layout || "none"}, ${audio.sampleRate} Hz` +
      (isUsableAudio(audio) ? "" : " (replaced by silence)")
    : "no audio stream";

/** ffmpeg could not set up the sound: the picture may still build without the clips' sound. */
const isAudioGraphError = (error: unknown): boolean =>
  /channel layout|Error reinitializing filters|Failed to inject frame|Rematrix is needed/i.test(
    error instanceof Error ? error.message : String(error),
  );

/** The hash of an input without rendering anything, to find a render that already exists. */
export function assemblyInputHash(input: AssembleInput): string {
  return reelInputHash({
    flashOpener: input.flashOpener,
    scenes: input.scenes,
    shots: input.shots,
    audio: input.audio,
  });
}

export async function assembleReel(
  input: AssembleInput,
  options: AssembleOptions = {},
): Promise<AssembledReel> {
  const plan = buildAssemblyPlan(input.scenes, input.shots, { flashOpener: input.flashOpener });
  const exec = options.exec ?? defaultExec;
  const tools = {
    exec,
    ffmpeg: options.ffmpegPath ?? "ffmpeg",
    ffprobe: options.ffprobePath ?? "ffprobe",
  };

  // Cards: one PNG per scene, drawn by Chromium unless a test gives its own.
  let browser: Browser | undefined;
  const ownBrowser = !options.cardRenderer && !options.browser;
  if (!options.cardRenderer) browser = options.browser ?? (await launchBrowser());
  const draw =
    options.cardRenderer ??
    ((card: string, line?: string) => renderCard(browser as Browser, card, line ?? ""));
  const cardsDir = join(input.workDir, "cards");
  await mkdir(cardsDir, { recursive: true });
  const cardPaths: Record<string, string> = {};
  const measures: Record<string, CardMeasure> = {};
  try {
    for (const scene of input.scenes) {
      const rendered = scene.line ? await draw(scene.card, scene.line) : await draw(scene.card);
      cardPaths[scene.id] = join(cardsDir, `${scene.id}.png`);
      await writeFile(cardPaths[scene.id] as string, rendered.png);
      measures[scene.id] = rendered.measure;
    }
  } finally {
    if (ownBrowser) await browser?.close();
  }

  // The page colour of every clip, measured once; a clip that cannot be read keeps the fixed lift.
  const pageLevels: Record<string, number> = {};
  const clips = [...new Set(plan.segments.map((s) => s.clipPath))];
  for (const [i, clipPath] of clips.entries()) {
    const at = plan.segments.find((s) => s.clipPath === clipPath)?.trimStart ?? 0;
    try {
      pageLevels[clipPath] = await measureClipPageLevel(
        clipPath,
        at + 0.2,
        tools,
        input.workDir,
        `clip-${i}`,
      );
    } catch {
      // Left out: the filter graph falls back to the fixed lift for this clip.
    }
  }

  // The model's own sound: which clips carry sound the graph can use (a refused or fallback shot may
  // have none), and what each clip's audio is, kept for the failure message.
  let modelAudio: Record<string, boolean> | undefined;
  const clipAudio: Record<string, ClipAudio | null> = {};
  if (input.audio?.kind === "MODEL_AUDIO") {
    modelAudio = {};
    for (const clipPath of clips) {
      clipAudio[clipPath] = await probeClipAudio(clipPath, tools);
      modelAudio[clipPath] = isUsableAudio(clipAudio[clipPath] ?? null);
    }
  }

  const ffmpegArgs = (withModelAudio: boolean) =>
    buildFfmpegArgs(plan, {
      cardPaths,
      pageLevels,
      outPath: input.outPath,
      ...(withModelAudio && modelAudio ? { modelAudio } : {}),
      ...(input.audio && "path" in input.audio ? { audio: { path: input.audio.path } } : {}),
      ...(options.crf !== undefined ? { crf: options.crf } : {}),
      ...(options.preset ? { preset: options.preset } : {}),
    });

  // What a failure message says about the clips, so the next failure can be diagnosed.
  const diagnostics = async (): Promise<string> => {
    const scenesOf = (clipPath: string) =>
      Object.entries(input.shots)
        .filter(([, shot]) => shot.path === clipPath)
        .map(([id]) => id)
        .join("+");
    const lines = clips.map(
      (clipPath) =>
        `  ${scenesOf(clipPath) || clipPath}: ${describeAudio(clipAudio[clipPath] ?? null)}`,
    );
    let version = "unknown";
    try {
      version = (await exec(tools.ffmpeg, ["-version"])).stdout.split("\n")[0] ?? version;
    } catch {
      // Left as unknown.
    }
    return `\nffmpeg: ${version}\nClip audio:\n${lines.join("\n")}`;
  };

  const warnings: string[] = [];
  let audioKind: ReelAudioKind = input.audio?.kind ?? "NONE";
  try {
    await exec(tools.ffmpeg, ffmpegArgs(true));
  } catch (error) {
    // The model's sound is a bonus: when ffmpeg cannot set it up, build the Reel once more silent.
    if (!modelAudio || !isAudioGraphError(error)) {
      throw new Error(`${errorMessage(error)}${await diagnostics()}`, { cause: error });
    }
    try {
      await exec(tools.ffmpeg, ffmpegArgs(false));
    } catch (retryError) {
      throw new Error(
        `${errorMessage(error)}\nThe retry without the model's sound failed too: ${errorMessage(retryError)}${await diagnostics()}`,
        { cause: retryError },
      );
    }
    audioKind = "NONE";
    warnings.push(
      `The model's sound was dropped, the Reel is silent: ffmpeg could not use it (${errorMessage(error).split("\n").slice(-3).join(" ").slice(0, 300)}).`,
    );
  }

  const { probe, qa } = await probeReel(input.outPath, tools, Object.values(measures));
  const sha256 = createHash("sha256")
    .update(await readFile(input.outPath))
    .digest("hex");
  return {
    path: input.outPath,
    inputHash: assemblyInputHash(input),
    plan,
    audioKind,
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    bytes: probe.bytes,
    sha256,
    qa: warnings.length > 0 ? { ...qa, warnings: [...qa.warnings, ...warnings] } : qa,
    cards: measures,
  };
}
