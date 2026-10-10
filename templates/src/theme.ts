import { DEFAULT_FONTS, familyById } from "./fonts";

// Theme tokens (plan 08 §8.3, M3-06): `brands.visual_system` plus the market's theme variant
// become CSS variables on the slide root. `@rc/templates` is pure and cannot import `@rc/db`, so
// the shape of `VisualSystem` is declared here structurally; the db type is assignable to it.

export type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  accent: string;
  positive: string;
  negative: string;
};

export type VisualSystemLike = {
  colors: ThemeColors;
  fonts: { display: string; body: string };
  logo: { assetKey: string; minHeightPx: number };
  spacing: { safeMarginPx: number };
  themeVariants: Readonly<Record<string, Partial<ThemeColors>>>;
};

/** Used while `brands.visual_system` is still `{}`. */
export const DEFAULT_VISUAL_SYSTEM: VisualSystemLike = {
  colors: {
    background: "#FAF6EF",
    surface: "#FFFFFF",
    text: "#1F1B16",
    accent: "#B5532F",
    positive: "#3F7D4E",
    negative: "#B3382C",
  },
  fonts: { ...DEFAULT_FONTS },
  logo: { assetKey: "", minHeightPx: 48 },
  spacing: { safeMarginPx: 72 },
  themeVariants: {},
};

export type Theme = {
  colors: ThemeColors;
  fonts: { display: string; body: string };
  safeMarginPx: number;
  logo: { assetKey: string; minHeightPx: number };
  /** The variant that was applied, if any. */
  variant: string | null;
};

const isConfigured = (v: unknown): v is VisualSystemLike =>
  typeof v === "object" && v !== null && "colors" in v && "fonts" in v;

/**
 * The brand's system with a theme variant on top (colors only). An empty or missing system falls
 * back to the default; an unknown variant name changes nothing; an unknown font family throws.
 */
export function buildTheme(system: unknown, variant?: string | null): Theme {
  const base = isConfigured(system) ? system : DEFAULT_VISUAL_SYSTEM;
  const overrides = (variant ? base.themeVariants?.[variant] : undefined) ?? {};
  familyById(base.fonts.display);
  familyById(base.fonts.body);
  return {
    colors: { ...base.colors, ...overrides },
    fonts: base.fonts,
    safeMarginPx: base.spacing.safeMarginPx,
    logo: base.logo,
    variant: variant && base.themeVariants?.[variant] ? variant : null,
  };
}

/** CSS custom properties of a theme, for the slide root's `style`. */
export function themeCssVariables(theme: Theme): Record<string, string> {
  const display = familyById(theme.fonts.display);
  const body = familyById(theme.fonts.body);
  return {
    "--rc-bg": theme.colors.background,
    "--rc-surface": theme.colors.surface,
    "--rc-text": theme.colors.text,
    "--rc-accent": theme.colors.accent,
    "--rc-positive": theme.colors.positive,
    "--rc-negative": theme.colors.negative,
    "--rc-font-display": `"${display.cssName}", ${display.kind}`,
    "--rc-font-body": `"${body.cssName}", ${body.kind}`,
    "--rc-safe-margin": `${theme.safeMarginPx}px`,
  };
}

export const cssVariablesText = (theme: Theme): string =>
  Object.entries(themeCssVariables(theme))
    .map(([name, value]) => `${name}:${value};`)
    .join("");
