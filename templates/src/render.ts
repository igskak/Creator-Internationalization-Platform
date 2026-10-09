// Server-only parts of the template package (they read font files): fonts, glyph checks, theme.
// Kept out of the main entry so that client bundles that import the registry stay free of node:fs.
export {
  DEFAULT_FONTS,
  FONT_FAMILIES,
  type FontFamily,
  type FontFile,
  familyById,
  fontFaceCss,
  readFontFile,
} from "./fonts";
export {
  CANVAS,
  escapeHtml,
  FIT_TEXT_SCRIPT,
  imageSlot,
  LINE_HEIGHT,
  type RenderAssets,
  type RenderContext,
  type RenderSlideInput,
  renderSlideHtml,
  type SlideData,
  slotBoxHeightPx,
  TEMPLATE_RENDERERS,
  type TemplateRenderer,
  textHtml,
  textSlot,
} from "./framework";
export {
  findMissingGlyphs,
  type MissingGlyph,
  missingGlyphs,
  type SlotText,
} from "./glyphs";
export {
  buildTheme,
  cssVariablesText,
  DEFAULT_VISUAL_SYSTEM,
  type Theme,
  type ThemeColors,
  themeCssVariables,
  type VisualSystemLike,
} from "./theme";
