import { describe, expect, it } from "vitest";
import {
  CommonMistake,
  Ingredient,
  KnowledgeSnapshot,
  ProcedureStep,
  SourceReference,
  Temperature,
  Timing,
} from "./knowledge";

describe("knowledge JSON shapes", () => {
  it("accepts a verified source reference and rejects a quote over 400 chars", () => {
    const ok = { pageStart: 3, quote: "synthetic quote", quoteVerified: true, matchScore: 0.98 };
    expect(SourceReference.parse(ok)).toEqual(ok);
    expect(SourceReference.safeParse({ ...ok, quote: "x".repeat(401) }).success).toBe(false);
    expect(SourceReference.safeParse({ ...ok, matchScore: 1.5 }).success).toBe(false);
    expect(SourceReference.safeParse({ quote: "q" }).success).toBe(false);
  });

  it("validates procedure steps and ingredients", () => {
    expect(ProcedureStep.safeParse({ n: 1, text: "Salt the water" }).success).toBe(true);
    expect(ProcedureStep.safeParse({ n: 0, text: "x" }).success).toBe(false);
    expect(ProcedureStep.safeParse({ n: 1, text: "" }).success).toBe(false);
    expect(Ingredient.safeParse({ name: "rice", quantity: 200, unit: "g" }).success).toBe(true);
    expect(Ingredient.safeParse({ name: "rice", quantity: -1 }).success).toBe(false);
  });

  it("validates temperatures with a known unit and target", () => {
    const t = { value: 180, unit: "C", target: "OVEN", context: "preheat" };
    expect(Temperature.safeParse(t).success).toBe(true);
    expect(Temperature.safeParse({ ...t, unit: "K" }).success).toBe(false);
    expect(Temperature.safeParse({ ...t, target: "GRILL" }).success).toBe(false);
  });

  it("requires valueMax >= value for timings", () => {
    const t = { value: 10, unit: "min", context: "rest" };
    expect(Timing.safeParse({ ...t, valueMax: 15 }).success).toBe(true);
    expect(Timing.safeParse({ ...t, valueMax: 5 }).success).toBe(false);
    expect(Timing.safeParse({ ...t, unit: "weeks" }).success).toBe(false);
  });

  it("validates common mistakes and a full snapshot", () => {
    expect(CommonMistake.safeParse({ mistake: "Cold pan" }).success).toBe(true);
    expect(CommonMistake.safeParse({ why: "no mistake" }).success).toBe(false);
    const snapshot = {
      title: "t",
      category: "TECHNIQUE",
      subcategory: null,
      claim: "c",
      explanation: "",
      procedure: [],
      ingredients: [],
      temperatures: [],
      timings: [],
      commonMistakes: [],
      sourceReference: null,
      language: "ru",
      safetySensitive: false,
      safetyNotes: null,
      tags: [],
    };
    expect(KnowledgeSnapshot.safeParse(snapshot).success).toBe(true);
    expect(KnowledgeSnapshot.safeParse({ ...snapshot, claim: "" }).success).toBe(false);
  });
});
