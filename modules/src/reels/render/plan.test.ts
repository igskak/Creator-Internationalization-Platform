import { describe, expect, it } from "vitest";
import { buildAssemblyPlan, type PlanScene } from "./plan";

const scene = (n: number, beats: number, layout: PlanScene["layout"] = "RIGHT"): PlanScene => ({
  id: `s${n}`,
  beats,
  card: `Card ${n}`,
  layout,
});
const scenes = [3.5, 3, 4, 4, 4.5, 4, 5].map((beats, i) => scene(i + 1, beats));
const shots = Object.fromEntries(scenes.map((s) => [s.id, { path: `/shots/${s.id}.mp4` }]));

describe("buildAssemblyPlan", () => {
  it("cuts one segment per scene on the 120 BPM grid, in order", () => {
    const plan = buildAssemblyPlan(scenes, shots, { flashOpener: false });
    expect(plan.segments.map((s) => s.sceneId)).toEqual(scenes.map((s) => s.id));
    expect(plan.segments.map((s) => s.seconds)).toEqual([1.75, 1.5, 2, 2, 2.25, 2, 2.5]);
    expect(plan.segments.every((s) => s.kind === "SCENE" && s.fadeSeconds === 0.12)).toBe(true);
    expect(plan.flashSeconds).toBe(0);
    expect(plan.totalSeconds).toBe(14);
    // Every cut lands on a beat: durations are multiples of half a second's half.
    for (const s of plan.segments) expect((s.seconds / 0.5) % 0.5).toBe(0);
  });

  it("puts four short slices of later shots in front, under the hook card", () => {
    const plan = buildAssemblyPlan(scenes, shots, { flashOpener: true });
    const flash = plan.segments.slice(0, 4);
    expect(flash.every((s) => s.kind === "FLASH" && s.cardSceneId === "s1")).toBe(true);
    expect(flash.map((s) => s.seconds)).toEqual([0.22, 0.22, 0.22, 0.22]);
    expect(flash.every((s) => s.fadeSeconds < 0.01)).toBe(true);
    // Never from the hook or the rule scene, and four different scenes.
    const from = flash.map((s) => s.sceneId);
    expect(new Set(from).size).toBe(4);
    expect(from.every((id) => !["s1", "s2"].includes(id))).toBe(true);
    expect(flash.every((s) => s.trimStart === 0.6)).toBe(true);
    expect(plan.segments).toHaveLength(7 + 4);
    expect(plan.flashSeconds).toBeCloseTo(0.88, 5);
    expect(plan.totalSeconds).toBeCloseTo(14.88, 3);
  });

  it("starts a scene where its shot says", () => {
    const plan = buildAssemblyPlan(
      scenes,
      { ...shots, s3: { path: "/x.mp4", trimStartSeconds: 1.25 } },
      { flashOpener: false },
    );
    expect(plan.segments[2]).toMatchObject({ trimStart: 1.25, clipPath: "/x.mp4" });
  });

  it("refuses a missing shot, no scenes, and too few scenes for the opener", () => {
    expect(() => buildAssemblyPlan(scenes, { s1: { path: "a" } }, { flashOpener: false })).toThrow(
      "No shot for scene s2",
    );
    expect(() => buildAssemblyPlan([], {}, { flashOpener: false })).toThrow("needs scenes");
    const few = scenes.slice(0, 5);
    expect(() => buildAssemblyPlan(few, shots, { flashOpener: true })).toThrow(
      "four scenes after the rule",
    );
  });
});
