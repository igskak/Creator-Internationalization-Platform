import { createHash } from "node:crypto";
import { RENDERER_VERSION } from "./constants";

// The input hash of a render (`reel_renders.input_hash`, plan 18 §18.3): the script's scenes with
// their cards, the identity of every shot, the audio and the renderer version. The same input gives
// the same hash, so a repeated request is a no-op.

export type HashInput = {
  flashOpener: boolean;
  scenes: readonly { id: string; beats: number; card: string; line?: string; layout: string }[];
  /** By scene id: the shot's content hash and where the scene starts in it. */
  shots: Readonly<Record<string, { sha256: string; trimStartSeconds?: number }>>;
  audio?: { kind: string; sha256?: string } | undefined;
};

export function reelInputHash(input: HashInput): string {
  const canonical = JSON.stringify([
    RENDERER_VERSION,
    input.flashOpener,
    input.scenes.map((s) => [
      s.id,
      s.beats,
      s.card,
      s.layout,
      input.shots[s.id]?.sha256 ?? null,
      input.shots[s.id]?.trimStartSeconds ?? 0,
      // Only a line that exists is hashed, so a v3 script keeps its hash shape.
      ...(s.line ? [s.line] : []),
    ]),
    input.audio ? [input.audio.kind, input.audio.sha256 ?? null] : null,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
