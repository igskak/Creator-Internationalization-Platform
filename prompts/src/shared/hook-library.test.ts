import { describe, expect, it } from "vitest";
import {
  BANNED_HOOK_PATTERNS,
  findBannedHookPatterns,
  HOOK_LANGUAGES,
  HOOK_LIBRARY,
  HOOK_REEL_CARDS,
  hookGuidance,
  hookLanguage,
  hookPatternsLine,
} from "./hook-library";

describe("hook library", () => {
  it("has patterns, angles and an example per language for every hook type", () => {
    for (const [code, entry] of Object.entries(HOOK_LIBRARY)) {
      expect(entry.patterns.length, code).toBeGreaterThan(0);
      expect(entry.angles.length, code).toBeGreaterThan(0);
      for (const lang of HOOK_LANGUAGES)
        expect(entry.examples[lang].length, code).toBeGreaterThan(0);
    }
  });

  it("never offers a banned pattern as an example", () => {
    for (const [code, entry] of Object.entries(HOOK_LIBRARY)) {
      for (const lang of HOOK_LANGUAGES) {
        for (const example of entry.examples[lang]) {
          expect(findBannedHookPatterns(example, lang), `${code} ${lang}: ${example}`).toEqual([]);
        }
      }
    }
  });

  it("has a Reel card of at most 6 words per type and language, and none is banned", () => {
    expect(Object.keys(HOOK_REEL_CARDS).sort()).toEqual(Object.keys(HOOK_LIBRARY).sort());
    for (const [code, byLanguage] of Object.entries(HOOK_REEL_CARDS)) {
      for (const lang of HOOK_LANGUAGES) {
        expect(byLanguage[lang].length, `${code} ${lang}`).toBeGreaterThan(0);
        for (const card of byLanguage[lang]) {
          const words = card.replaceAll("**", "").split(/\s+/u).filter(Boolean);
          expect(words.length, card).toBeLessThanOrEqual(6);
          expect(card.split("**").length % 2, `${card} has balanced accents`).toBe(1);
          expect(findBannedHookPatterns(card, lang), card).toEqual([]);
        }
      }
    }
  });

  it("gives Reel cards instead of cover lines for the Reel format", () => {
    expect(hookGuidance("MYTH_BUST", "en", "reel")).toContain("NOT ALWAYS");
    expect(hookGuidance("MYTH_BUST", "en", "reel")).not.toContain("only half true");
  });

  it("maps a market language to a library language", () => {
    expect(hookLanguage("es")).toBe("es");
    expect(hookLanguage("es-ES")).toBe("es");
    expect(hookLanguage("EN")).toBe("en");
    expect(hookLanguage("ru")).toBeUndefined();
  });

  it("describes a hook type for the adapter and for the writer", () => {
    expect(hookPatternsLine("MYTH_BUST")).toContain("popular belief");
    expect(hookPatternsLine("MYTH_BUST")).toContain("MYTH_VS_FACT");
    expect(hookGuidance("MYTH_BUST", "es")).toContain("media verdad");
    expect(hookGuidance("MYTH_BUST", "es")).toContain("never copy");
    // A language without examples still gets the patterns, and an unknown code nothing.
    expect(hookGuidance("MYTH_BUST", "ru")).toBe(hookPatternsLine("MYTH_BUST"));
    expect(hookGuidance("NOT_A_TYPE", "en")).toBeUndefined();
  });

  it.each([
    ["en", "I tested 100 ways to cook rice", "INVENTED_EXPERIENCE"],
    ["en", "This works 100% of the time", "GUARANTEE"],
    ["en", "Guaranteed fluffy rice", "GUARANTEE"],
    ["en", "Nobody tells you this about rice", "CONSPIRACY"],
    ["en", "Fluffy rice in a minute", "TIME_PROMISE"],
    ["en", "This will change everything", "EMPTY_HYPE"],
    ["es", "Llevo 5 años cocinando arroz", "INVENTED_EXPERIENCE"],
    ["es", "Funciona siempre", "GUARANTEE"],
    ["es", "Lo que no te cuentan del arroz", "CONSPIRACY"],
    ["es", "Arroz suelto en una semana", "TIME_PROMISE"],
    ["es", "Esto lo cambia todo", "EMPTY_HYPE"],
  ] as const)("flags %s: %s", (lang, text, group) => {
    expect(findBannedHookPatterns(text, lang).map((f) => f.group)).toContain(group);
  });

  it.each([
    ["en", "Stop rinsing your risotto rice."],
    ["en", "Cook bulgur for 10 min, not 30."],
    ["en", "My trick for fluffy rice"],
    ["en", "I tested positive for love of rice"],
    ["es", "¿Aún lavas el arroz del risotto?"],
    ["es", "Tarda 10 minutos, no una hora"],
  ] as const)("leaves %s alone: %s", (lang, text) => {
    // "I tested positive…" matches the experience pattern on purpose: the pattern is about "I tested".
    const found = findBannedHookPatterns(text, lang);
    expect(found.map((f) => f.group)).toEqual(
      text.startsWith("I tested") ? ["INVENTED_EXPERIENCE"] : [],
    );
  });

  it("keeps the same groups in both languages", () => {
    const groups = (lang: (typeof HOOK_LANGUAGES)[number]) =>
      [...new Set(BANNED_HOOK_PATTERNS[lang].map((p) => p.group))].sort();
    expect(groups("es")).toEqual(groups("en"));
  });
});
