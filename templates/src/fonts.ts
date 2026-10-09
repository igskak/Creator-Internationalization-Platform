import { readFileSync } from "node:fs";

// Bundled fonts (plan 08 §8.3, M3-06). Brand fonts are not licensed for embedding yet (Track B
// B-10), so the SIL OFL fallback is Fraunces (display serif) and Inter (sans), Latin and Latin
// Extended, which covers Spanish and English with `ñ ¿ ¡ á é í ó ú ü ° ½`. Files are WOFF2
// variable fonts in `templates/assets/fonts`; the renderer embeds them as data URLs, so no
// system font and no network is involved. `brands.visual_system.fonts` names a family by `id`.

export type FontFile = {
  /** Path under `assets/fonts`. */
  path: string;
  /** CSS `unicode-range` of the subset, as published by the font's maintainers. */
  unicodeRange: string;
};

export type FontFamily = {
  id: string;
  /** CSS `font-family` name. */
  cssName: string;
  /** Weights the variable font covers. */
  weights: string;
  kind: "serif" | "sans-serif";
  files: readonly FontFile[];
};

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

export const FONT_FAMILIES: Readonly<Record<string, FontFamily>> = {
  fraunces: {
    id: "fraunces",
    cssName: "Fraunces",
    weights: "100 900",
    kind: "serif",
    files: [
      { path: "fraunces/fraunces-latin-wght-normal.woff2", unicodeRange: LATIN },
      { path: "fraunces/fraunces-latin-ext-wght-normal.woff2", unicodeRange: LATIN_EXT },
    ],
  },
  inter: {
    id: "inter",
    cssName: "Inter",
    weights: "100 900",
    kind: "sans-serif",
    files: [
      { path: "inter/inter-latin-wght-normal.woff2", unicodeRange: LATIN },
      { path: "inter/inter-latin-ext-wght-normal.woff2", unicodeRange: LATIN_EXT },
    ],
  },
};

export const DEFAULT_FONTS = { display: "fraunces", body: "inter" } as const;

export const familyById = (id: string): FontFamily => {
  const family = FONT_FAMILIES[id];
  if (!family) throw new Error(`Unknown font family "${id}".`);
  return family;
};

const cache = new Map<string, Buffer>();

/** The bytes of a bundled font file (cached). */
export function readFontFile(path: string): Buffer {
  let bytes = cache.get(path);
  if (!bytes) {
    bytes = readFileSync(new URL(`../assets/fonts/${path}`, import.meta.url));
    cache.set(path, bytes);
  }
  return bytes;
}

/** `@font-face` rules of a family with the files inlined as data URLs. */
export function fontFaceCss(id: string): string {
  const family = familyById(id);
  return family.files
    .map((file) => {
      const data = readFontFile(file.path).toString("base64");
      return `@font-face{font-family:"${family.cssName}";font-style:normal;font-weight:${family.weights};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${file.unicodeRange};}`;
    })
    .join("\n");
}
