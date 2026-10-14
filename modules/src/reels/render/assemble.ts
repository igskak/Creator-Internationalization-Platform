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
  audio?: { path: string; kind: Exclude<ReelAudioKind, "NONE">; sha256: string };
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
  cardRenderer?: (card: string) => Promise<RenderedCard>;
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
  const draw = options.cardRenderer ?? ((card: string) => renderCard(browser as Browser, card));
  const cardsDir = join(input.workDir, "cards");
  await mkdir(cardsDir, { recursive: true });
  const cardPaths: Record<string, string> = {};
  const measures: Record<string, CardMeasure> = {};
  try {
    for (const scene of input.scenes) {
      const rendered = await draw(scene.card);
      cardPaths[scene.id] = join(cardsDir, `${scene.id}.png`);
      await writeFile(cardPaths[scene.id] as string, rendered.png);
      measures[scene.id] = rendered.measure;
    }
  } finally {
    if (ownBrowser) await browser?.close();
  }

  await exec(
    tools.ffmpeg,
    buildFfmpegArgs(plan, {
      cardPaths,
      outPath: input.outPath,
      ...(input.audio ? { audio: { path: input.audio.path } } : {}),
      ...(options.crf !== undefined ? { crf: options.crf } : {}),
      ...(options.preset ? { preset: options.preset } : {}),
    }),
  );

  const { probe, qa } = await probeReel(input.outPath, tools, Object.values(measures));
  const sha256 = createHash("sha256")
    .update(await readFile(input.outPath))
    .digest("hex");
  return {
    path: input.outPath,
    inputHash: assemblyInputHash(input),
    plan,
    audioKind: input.audio?.kind ?? "NONE",
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    bytes: probe.bytes,
    sha256,
    qa,
    cards: measures,
  };
}
