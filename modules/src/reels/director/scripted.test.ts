import { reelDirector } from "@rc/prompts";
import { REEL_POSTS } from "@rc/prompts/fixtures/reel-director";
import { describe, expect, it } from "vitest";
import { scriptedReelScript } from "../../ai/scripted-reel";
import type { NumberLocale } from "../../localization";
import { reelValidationContext, validateReelScript } from "./validate";

// The scripted Reel director of the E2E server (M8-07a): its answer must pass the same checks a
// real script does, whatever carousel the request holds. Synthetic content only.

type Input = reelDirector.ReelDirectorInput;

const textOf = (input: Input) =>
  reelDirector.reelDirectorV1
    .render(input)
    .flatMap((m) => (m.type === "text" ? [m.text] : []))
    .join("\n");

/** What the E2E drafts look like: slide ids and texts of the scripted writer, pictures of the fake image provider. */
const e2eInput = (code: string, language: string, slides: number): Input => ({
  market: { code, displayName: code, language },
  carousel: {
    hook: "Copy hook",
    hookType: "MYTH_BUST",
    slides: Array.from({ length: slides }, (_, i) => ({
      id: `slide-${i + 1}`,
      role: i === 0 ? "HOOK" : "FACT",
      text: i === 0 ? "Copy hook" : `Copy body ${i}`,
      factual: i > 0,
      knowledgeIds: i > 0 ? ["card-1"] : [],
    })),
  },
  pictures: [
    { id: "pic-1", slideId: "slide-1", description: "Rice grains in a bowl" },
    { id: "pic-2", slideId: "slide-2", description: "Rice in a pot" },
  ],
  brief: { tone: "Warm.", terminology: [], ctaType: "SAVE" },
  taxonomy: {
    hookTypes: [
      { code: "MISTAKE_CALLOUT", label: "Mistake callout" },
      { code: "MYTH_BUST", label: "Myth bust" },
      { code: "CURIOSITY_GAP", label: "Curiosity gap" },
      { code: "HOW_TO_PROMISE", label: "How-to promise" },
    ],
  },
  recentHookTypes: [],
});

const LOCALES: Record<string, NumberLocale> = { "es-ES": "es-ES", en: "en" };
const inputs: [string, Input][] = [
  ...REEL_POSTS.map((p): [string, Input] => [p.key, p.input]),
  ["e2e es-ES, 5 slides", e2eInput("es-ES", "es", 5)],
  ["e2e en, 6 slides", e2eInput("en", "en", 6)],
  ["a one-slide carousel", e2eInput("en", "en", 1)],
];

describe("scriptedReelScript", () => {
  it.each(inputs)("answers %s with a script that passes every check", (_name, input) => {
    const output = scriptedReelScript(textOf(input));
    expect(() => reelDirector.reelDirectorOutputFor(input).parse(output)).not.toThrow();
    const issues = validateReelScript(
      output,
      reelValidationContext(input, { locale: LOCALES[input.market.code] ?? "en" }),
    );
    expect(issues).toEqual([]);
  });

  it("writes the cards in the language of the market and three different hook types", () => {
    const es = scriptedReelScript(textOf(e2eInput("es-ES", "es", 5)));
    expect(es.scenes[0]?.card).toContain("arroz");
    const en = scriptedReelScript(textOf(e2eInput("en", "en", 6)));
    expect(en.scenes[0]?.card).toContain("rice");
    expect(new Set(en.hookOptions.map((h) => h.hookType)).size).toBe(3);
    expect(en.hookOptions.map((h) => h.hookType)).toEqual([
      "MISTAKE_CALLOUT",
      "MYTH_BUST",
      "CURIOSITY_GAP",
    ]);
  });
});
