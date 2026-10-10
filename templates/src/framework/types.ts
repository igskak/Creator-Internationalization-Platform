import type { TemplateDefinition } from "../define-template";
import type { Theme } from "../theme";

// Rendering framework types (plan 08 §8.2, §8.6, M3-07). The slide is described structurally so
// that `@rc/templates` stays free of `@rc/db`; the db `Slide` is assignable to `SlideData`.

export type SlideData = {
  id: string;
  index: number;
  role: string;
  templateId: string;
  slots: Readonly<Record<string, string>>;
  images?: Readonly<Record<string, unknown>>;
};

/** What the page needs besides text: images and the logo as data URLs (no network at render). */
export type RenderAssets = {
  /** Image slot name → data URL of the normalized picture. */
  images: Readonly<Record<string, string>>;
  /** Data URL of the brand logo (SVG or PNG); without it a text mark is drawn. */
  logo?: string;
};

export type RenderContext = {
  slide: SlideData;
  template: Readonly<TemplateDefinition>;
  theme: Theme;
  assets: RenderAssets;
  /** 1-based position and total, for the page indicator. */
  page: { index: number; count: number };
};

/** One template's markup and its own CSS; the shell (canvas, logo, page indicator) is shared. */
export type TemplateRenderer = {
  css: string;
  body(context: RenderContext): string;
};
