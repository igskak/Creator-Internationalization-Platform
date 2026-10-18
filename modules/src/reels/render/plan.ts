import { CARD, FLASH, SECONDS_PER_BEAT } from "./constants";

// The cut list of a Reel (reel-style.md "Format"): one segment per scene on the 120 BPM grid, and
// with the flash opener four short slices of later shots in front of the first scene. Without it the
// hook card is on screen from the first frame (no fade), so the viewer reads the question at once.
// Pure data in, pure data out, so the grid and the opener are tested without ffmpeg.

export type PlanScene = {
  id: string;
  beats: number;
  card: string;
  layout: "RIGHT" | "FULL";
};

export type PlanShot = {
  /** Local file of the shot (the caller fetched it from storage). */
  path: string;
  /** Where in the clip the scene starts, seconds. */
  trimStartSeconds?: number;
};

export type Segment = {
  /** Scene the picture comes from. */
  sceneId: string;
  /** Scene whose card is drawn: the first scene's for the flash. */
  cardSceneId: string;
  kind: "SCENE" | "FLASH";
  clipPath: string;
  trimStart: number;
  seconds: number;
  layout: "RIGHT" | "FULL";
  /** Seconds of the card's fade-in; the flash shows the hook card at once. */
  fadeSeconds: number;
};

export type AssemblyPlan = {
  segments: Segment[];
  /** Length of the flash opener; the beat starts after it. */
  flashSeconds: number;
  totalSeconds: number;
};

export function buildAssemblyPlan(
  scenes: readonly PlanScene[],
  shots: Readonly<Record<string, PlanShot>>,
  options: { flashOpener: boolean },
): AssemblyPlan {
  const shotOf = (id: string): PlanShot => {
    const shot = shots[id];
    if (!shot) throw new Error(`No shot for scene ${id}.`);
    return shot;
  };
  const segments: Segment[] = [];
  const first = scenes[0];
  if (!first) throw new Error("A Reel needs scenes.");

  let flashSeconds = 0;
  if (options.flashOpener) {
    // Four later scenes, spread over the body: never the hook or the rule scene.
    const body = scenes.slice(2);
    if (body.length < FLASH.shots)
      throw new Error("The flash opener needs four scenes after the rule.");
    const picks = Array.from({ length: FLASH.shots }, (_, i) =>
      Math.floor(((i + 0.5) * body.length) / FLASH.shots),
    );
    for (const pick of picks) {
      const scene = body[pick];
      if (!scene) continue;
      const shot = shotOf(scene.id);
      segments.push({
        sceneId: scene.id,
        cardSceneId: first.id,
        kind: "FLASH",
        clipPath: shot.path,
        trimStart: (shot.trimStartSeconds ?? 0) + FLASH.clipOffsetSeconds,
        seconds: FLASH.shotSeconds,
        layout: scene.layout,
        fadeSeconds: 0.001,
      });
    }
    flashSeconds = FLASH.shots * FLASH.shotSeconds;
  }
  for (const [i, scene] of scenes.entries()) {
    const shot = shotOf(scene.id);
    segments.push({
      sceneId: scene.id,
      cardSceneId: scene.id,
      kind: "SCENE",
      clipPath: shot.path,
      trimStart: shot.trimStartSeconds ?? 0,
      seconds: scene.beats * SECONDS_PER_BEAT,
      layout: scene.layout,
      fadeSeconds: i === 0 && !options.flashOpener ? 0.001 : CARD.fadeSeconds,
    });
  }
  const totalSeconds = segments.reduce((sum, s) => sum + s.seconds, 0);
  return { segments, flashSeconds, totalSeconds: Math.round(totalSeconds * 1000) / 1000 };
}
