import { describe, expect, it } from "vitest";
import {
  buildTheme,
  cssVariablesText,
  DEFAULT_VISUAL_SYSTEM,
  FONT_FAMILIES,
  findMissingGlyphs,
  fontFaceCss,
  missingGlyphs,
  themeCssVariables,
} from "./render";

describe("fonts", () => {
  it("has WOFF2 files that fontkit can open, for every family", () => {
    for (const id of Object.keys(FONT_FAMILIES)) {
      expect(missingGlyphs("Abc", id)).toEqual([]);
    }
  });

  it("builds @font-face rules with the files inlined and the unicode ranges", () => {
    const css = fontFaceCss("fraunces");
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain("src:url(data:font/woff2;base64,");
    expect(css).toContain('font-family:"Fraunces"');
    expect(css).toContain("unicode-range:U+0000-00FF");
    expect(() => fontFaceCss("comic-sans")).toThrow("Unknown font family");
  });
});

describe("glyph coverage", () => {
  const spanish =
    "¿Qué hace el almidón? Añade 180 °C, ½ taza; ¡ojo! Ü ü Ñ ñ á é í ó ú “comillas” – —";
  const english = "Don’t rinse: 350 °F (180 °C) – 2½ cups, naïve café";

  it.each(["fraunces", "inter"])("covers Spanish and English text in %s", (id) => {
    expect(missingGlyphs(spanish, id)).toEqual([]);
    expect(missingGlyphs(english, id)).toEqual([]);
  });

  it("reports emoji and characters of other scripts once each, in order", () => {
    expect(missingGlyphs("Rice 🍚 is nice 🍚 漢", "inter")).toEqual(["🍚", "漢"]);
  });

  it("ignores spaces and line breaks", () => {
    expect(missingGlyphs("a b\nc\t d​", "fraunces")).toEqual([]);
  });

  it("reports per slot with the font the slot uses", () => {
    const result = findMissingGlyphs(
      [
        { slideId: "s1", slot: "headline", text: "Hola ñ", font: "display" },
        { slideId: "s2", slot: "body", text: "Cook 🔥", font: "body" },
      ],
      { display: "fraunces", body: "inter" },
    );
    expect(result).toEqual([{ slideId: "s2", slot: "body", chars: ["🔥"] }]);
  });
});

describe("theme", () => {
  it("falls back to the default system while the brand has none", () => {
    expect(buildTheme({})).toMatchObject({
      colors: DEFAULT_VISUAL_SYSTEM.colors,
      fonts: { display: "fraunces", body: "inter" },
      safeMarginPx: 72,
      variant: null,
    });
  });

  it("puts a theme variant's colors over the brand's, and ignores an unknown variant", () => {
    const system = {
      ...DEFAULT_VISUAL_SYSTEM,
      themeVariants: { "warm-mediterranean": { accent: "#C65D2E", background: "#FBEFDD" } },
    };
    const warm = buildTheme(system, "warm-mediterranean");
    expect(warm.colors).toMatchObject({
      accent: "#C65D2E",
      background: "#FBEFDD",
      text: "#1F1B16",
    });
    expect(warm.variant).toBe("warm-mediterranean");
    expect(buildTheme(system, "nope").colors).toEqual(DEFAULT_VISUAL_SYSTEM.colors);
    expect(buildTheme(system, "nope").variant).toBeNull();
  });

  it("rejects a font family that is not bundled", () => {
    const system = { ...DEFAULT_VISUAL_SYSTEM, fonts: { display: "papyrus", body: "inter" } };
    expect(() => buildTheme(system)).toThrow("Unknown font family");
  });

  it("turns a theme into CSS variables", () => {
    const vars = themeCssVariables(buildTheme({}));
    expect(vars).toMatchObject({
      "--rc-bg": "#FAF6EF",
      "--rc-font-display": '"Fraunces", serif',
      "--rc-font-body": '"Inter", sans-serif',
      "--rc-safe-margin": "72px",
    });
    expect(cssVariablesText(buildTheme({}))).toContain("--rc-accent:#B5532F;");
  });
});
