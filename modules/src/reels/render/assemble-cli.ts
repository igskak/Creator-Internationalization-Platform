import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assembleReel } from "./assemble";

// `pnpm reels:assemble <spec.json> <out.mp4>` (M8-05): assembles a Reel from local files, to look
// at the result before the generate service (M8-06) exists. The spec:
//   { "flashOpener": true,
//     "scenes": [{ "id": "s1", "beats": 4, "card": "Hot water on **bulgur?**", "layout": "RIGHT" }, …],
//     "shots": { "s1": { "path": "clips/1.mp4", "trimStartSeconds": 0 }, … },
//     "audio": { "path": "beat.wav", "kind": "PLACEHOLDER_BEAT" } }
// Paths are relative to the spec file. Prints the QA report; exit code 1 when it has warnings.

type Spec = {
  flashOpener?: boolean;
  scenes: { id: string; beats: number; card: string; layout?: "RIGHT" | "FULL" }[];
  shots: Record<string, { path: string; trimStartSeconds?: number }>;
  audio?: { path: string; kind?: "PLACEHOLDER_BEAT" | "OWNER_TRACK" };
};

const [specArg, outArg] = process.argv.slice(2);
if (!specArg || !outArg) {
  console.error("usage: pnpm reels:assemble <spec.json> <out.mp4>");
  process.exit(2);
}
const specPath = resolve(specArg);
const base = dirname(specPath);
const spec = JSON.parse(readFileSync(specPath, "utf8")) as Spec;
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const at = (p: string) => resolve(base, p);

const outPath = resolve(outArg);
mkdirSync(dirname(outPath), { recursive: true });
const reel = await assembleReel({
  flashOpener: spec.flashOpener ?? false,
  scenes: spec.scenes.map((s) => ({ ...s, layout: s.layout ?? "RIGHT" })),
  shots: Object.fromEntries(
    Object.entries(spec.shots).map(([id, s]) => [
      id,
      {
        path: at(s.path),
        sha256: sha(at(s.path)),
        ...(s.trimStartSeconds !== undefined ? { trimStartSeconds: s.trimStartSeconds } : {}),
      },
    ]),
  ),
  ...(spec.audio
    ? {
        audio: {
          path: at(spec.audio.path),
          kind: spec.audio.kind ?? "PLACEHOLDER_BEAT",
          sha256: sha(at(spec.audio.path)),
        },
      }
    : {}),
  workDir: join(dirname(outPath), `${outArg.replace(/^.*\//u, "").replace(/\.mp4$/u, "")}-work`),
  outPath,
});
console.log(
  JSON.stringify(
    { path: reel.path, durationMs: reel.durationMs, inputHash: reel.inputHash, qa: reel.qa },
    null,
    2,
  ),
);
process.exit(reel.qa.warnings.length === 0 ? 0 : 1);
