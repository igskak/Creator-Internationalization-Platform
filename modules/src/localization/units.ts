// Deterministic unit conversion and per-market number formatting (plan 07 §7.9.3). The market
// adapter picks which conversions to show; the writer receives the computed strings, never converts.

export type MeasurementSystem = "METRIC" | "IMPERIAL" | "DUAL";
/** Locales the formatter and the number parser know: market codes plus `ru` for card texts. */
export type NumberLocale = "es-ES" | "en" | "ru";

/** Units that convert between systems. */
export type Unit = "C" | "F" | "g" | "kg" | "oz" | "lb" | "ml" | "l" | "floz" | "cup" | "cm" | "in";
export type Quantity = { value: number; unit: Unit };

/** Everything the text scanner recognizes: convertible units plus time, percent and bare degrees. */
export type ScanUnit = Unit | "deg" | "s" | "min" | "h" | "d" | "%";

export const OZ_G = 28.349523125;
export const LB_G = 453.59237;
export const FLOZ_ML = 29.5735295625;
export const IN_CM = 2.54;
/** US legal cup, the value on nutrition labels; standard kitchen fractions of it are 60, 80, 120 … ml. */
export const CUP_ML = 240;

/** Fractions of a cup that count as "standard kitchen values". */
const STANDARD_CUPS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 1.25, 1.5, 2, 2.5, 3, 4] as const;
const CUP_MATCH_TOLERANCE = 0.05;

const roundTo = (value: number, step: number) =>
  Number((Math.round(value / step) * step).toFixed(6));

/**
 * Source for one unit: regular expression text (matched case-insensitively, whole word) and the
 * canonical unit. Longer or more specific patterns come first. Shared with the numeric scanner.
 */
export const UNIT_PATTERNS: readonly { source: string; unit: ScanUnit }[] = [
  {
    source: String.raw`[°º˚]\s?C\b|°\s?Celsius|degrees?\s+(?:Celsius|C)\b|grados?\s+(?:Celsius|centígrados|C)\b`,
    unit: "C",
  },
  {
    source: String.raw`[°º˚]\s?F\b|degrees?\s+(?:Fahrenheit|F)\b|grados?\s+(?:Fahrenheit|F)\b`,
    unit: "F",
  },
  { source: String.raw`[°º˚]|degrees?|grados?|градус(?:ов|а)?`, unit: "deg" },
  { source: String.raw`kgs?|kilos?|kilograms?|kilogramos?|кг|килограмм(?:ов|а)?`, unit: "kg" },
  { source: String.raw`gr?s?|grams?|gramos?|г|гр|грамм(?:ов|а)?`, unit: "g" },
  {
    source: String.raw`mls?|milliliters?|millilitres?|mililitros?|мл|миллилитр(?:ов|а)?`,
    unit: "ml",
  },
  { source: String.raw`fl\.?\s?oz|fluid\s+ounces?|onzas?\s+líquidas?`, unit: "floz" },
  { source: String.raw`oz|ounces?|onzas?|унци(?:я|и|й)`, unit: "oz" },
  { source: String.raw`lbs?|pounds?|libras?|фунт(?:а|ов)?`, unit: "lb" },
  { source: String.raw`cups?|tazas?|стакан(?:а|ов)?`, unit: "cup" },
  { source: String.raw`l|liters?|litres?|litros?|л|литр(?:ов|а)?`, unit: "l" },
  { source: String.raw`cm|centimeters?|centimetres?|centímetros?|см`, unit: "cm" },
  { source: String.raw`inch(?:es)?|pulgadas?|″|"`, unit: "in" },
  { source: String.raw`mins?|minutes?|minutos?|мин|минут(?:ы|а)?`, unit: "min" },
  { source: String.raw`h|hrs?|hours?|horas?|ч|час(?:а|ов)?`, unit: "h" },
  { source: String.raw`s|secs?|seconds?|segundos?|seg|сек(?:унд(?:ы|а)?)?`, unit: "s" },
  { source: String.raw`days?|d[ií]as?|сут(?:ки|ок)?|дн(?:я|ей)?`, unit: "d" },
  { source: String.raw`%|por\s?ciento|per\s?cent|percent|процент(?:ов|а)?`, unit: "%" },
];

const ANCHORED_PATTERNS = UNIT_PATTERNS.map(({ source, unit }) => ({
  re: new RegExp(`^(?:${source})$`, "iu"),
  unit,
}));

/** "г" → "g", "°F" → "F", "fl oz" → "floz"; undefined for unknown units such as "pcs" or "tbsp". */
export function parseUnit(text: string): ScanUnit | undefined {
  const trimmed = text.trim();
  return ANCHORED_PATTERNS.find((p) => p.re.test(trimmed))?.unit;
}

const isConvertible = (unit: ScanUnit | undefined): unit is Unit =>
  unit !== undefined && !["deg", "s", "min", "h", "d", "%"].includes(unit);

// ---------------------------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------------------------

/**
 * °C ↔ °F. Oven values are rounded to 5 degrees, every other target (core, pan, oil, water,
 * fridge …) to 1 degree. The plan fixes the °F rounding only; °C from °F follows the same steps.
 */
export function convertTemperature(value: number, from: "C" | "F", target?: string): Quantity {
  const step = target === "OVEN" ? 5 : 1;
  return from === "C"
    ? { value: roundTo((value * 9) / 5 + 32, step), unit: "F" }
    : { value: roundTo(((value - 32) * 5) / 9, step), unit: "C" };
}

const toGrams = (q: Quantity) =>
  q.unit === "g"
    ? q.value
    : q.unit === "kg"
      ? q.value * 1000
      : q.unit === "oz"
        ? q.value * OZ_G
        : q.value * LB_G;
const toMl = (q: Quantity) =>
  q.unit === "ml"
    ? q.value
    : q.unit === "l"
      ? q.value * 1000
      : q.unit === "floz"
        ? q.value * FLOZ_ML
        : q.value * CUP_ML;
const toCm = (q: Quantity) => (q.unit === "cm" ? q.value : q.value * IN_CM);

const MASS = new Set<Unit>(["g", "kg", "oz", "lb"]);
const VOLUME = new Set<Unit>(["ml", "l", "floz", "cup"]);
const LENGTH = new Set<Unit>(["cm", "in"]);
const METRIC = new Set<Unit>(["C", "g", "kg", "ml", "l", "cm"]);

export const isMetric = (unit: Unit) => METRIC.has(unit);

/**
 * Standard kitchen values only: grams below a pound as ounces (¼ oz steps), above as pounds
 * (0.1 lb); millilitres as a standard cup fraction when within 5 %, else fluid ounces (½ steps);
 * centimetres as inches (¼ steps). Undefined when the value is too small to show (rounds to 0).
 */
export function toImperial(q: Quantity): Quantity | undefined {
  if (!isMetric(q.unit)) return q;
  let result: Quantity | undefined;
  if (MASS.has(q.unit)) {
    const g = toGrams(q);
    result =
      g < LB_G
        ? { value: roundTo(g / OZ_G, 0.25), unit: "oz" }
        : { value: roundTo(g / LB_G, 0.1), unit: "lb" };
  } else if (VOLUME.has(q.unit)) {
    const ml = toMl(q);
    const cups = STANDARD_CUPS.find(
      (c) => Math.abs(ml - c * CUP_ML) <= CUP_MATCH_TOLERANCE * c * CUP_ML,
    );
    result =
      cups !== undefined
        ? { value: cups, unit: "cup" }
        : { value: roundTo(ml / FLOZ_ML, 0.5), unit: "floz" };
  } else if (LENGTH.has(q.unit)) {
    result = { value: roundTo(toCm(q) / IN_CM, 0.25), unit: "in" };
  }
  return result && result.value > 0 ? result : undefined;
}

/** Ounces and pounds to grams (steps of 5 g from 50 g, else 1 g) or kilograms (0.05 kg); likewise volume and length. */
export function toMetric(q: Quantity): Quantity | undefined {
  if (isMetric(q.unit)) return q;
  let result: Quantity | undefined;
  if (MASS.has(q.unit)) {
    const g = toGrams(q);
    result =
      g >= 1000
        ? { value: roundTo(g / 1000, 0.05), unit: "kg" }
        : { value: roundTo(g, g >= 50 ? 5 : 1), unit: "g" };
  } else if (VOLUME.has(q.unit)) {
    const ml = toMl(q);
    result =
      ml >= 1000
        ? { value: roundTo(ml / 1000, 0.05), unit: "l" }
        : { value: roundTo(ml, ml >= 50 ? 5 : 1), unit: "ml" };
  } else if (LENGTH.has(q.unit)) {
    result = { value: roundTo(toCm(q), 0.5), unit: "cm" };
  }
  return result && result.value > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

const FRACTION_GLYPHS: readonly [number, string][] = [
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [1 / 2, "½"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
];

const formatters = new Map<string, Intl.NumberFormat>();
/** Decimal comma for es-ES and ru, point for en; no grouping; at most 2 decimals. */
export function formatNumber(value: number, locale: NumberLocale): string {
  const tag = locale === "en" ? "en-US" : locale === "ru" ? "ru-RU" : "es-ES";
  let formatter = formatters.get(tag);
  if (!formatter) {
    formatter = new Intl.NumberFormat(tag, { maximumFractionDigits: 2, useGrouping: false });
    formatters.set(tag, formatter);
  }
  return formatter.format(value);
}

function formatCups(value: number): string {
  const whole = Math.floor(value + 1e-9);
  const fraction = value - whole;
  if (fraction < 1e-9) return String(whole);
  const glyph = FRACTION_GLYPHS.find(([f]) => Math.abs(f - fraction) < 1e-6)?.[1];
  return glyph ? `${whole > 0 ? whole : ""}${glyph}` : String(roundTo(value, 0.01));
}

const LABELS: Record<Exclude<Unit, "cup">, string> = {
  C: "°C",
  F: "°F",
  g: "g",
  kg: "kg",
  oz: "oz",
  lb: "lb",
  ml: "ml",
  l: "l",
  floz: "fl oz",
  cm: "cm",
  in: "in",
};

/** `180 °C`, `8.75 oz`, `1½ cups`. */
export function formatQuantity(q: Quantity, locale: NumberLocale): string {
  if (q.unit === "cup") {
    const word =
      locale === "es-ES" ? (q.value > 1 ? "tazas" : "taza") : q.value > 1 ? "cups" : "cup";
    return `${formatCups(q.value)} ${word}`;
  }
  return `${formatNumber(q.value, locale)} ${LABELS[q.unit]}`;
}

export type MarketUnits = { locale: NumberLocale; measurementSystem: MeasurementSystem };

/**
 * One quantity for a market: METRIC shows metric, IMPERIAL imperial, DUAL imperial first with the
 * metric original in brackets (`350 °F (180 °C)`, `8.75 oz (250 g)`). Falls back to the original
 * when the conversion is too small to show.
 */
export function displayQuantity(q: Quantity, market: MarketUnits, target?: string): string {
  const { locale, measurementSystem } = market;
  const other = convertedCounterpart(q, target);
  const metric = isMetric(q.unit) ? q : other;
  const imperial = isMetric(q.unit) ? other : q;
  if (measurementSystem === "METRIC") return formatQuantity(metric ?? q, locale);
  if (measurementSystem === "IMPERIAL") return formatQuantity(imperial ?? q, locale);
  if (!metric || !imperial) return formatQuantity(q, locale);
  return `${formatQuantity(imperial, locale)} (${formatQuantity(metric, locale)})`;
}

function convertedCounterpart(q: Quantity, target?: string): Quantity | undefined {
  if (q.unit === "C" || q.unit === "F") return convertTemperature(q.value, q.unit, target);
  return isMetric(q.unit) ? toImperial(q) : toMetric(q);
}

export type CardTemperature = { value: number; unit: "C" | "F"; target?: string; context?: string };
export type CardTiming = {
  value: number;
  valueMax?: number;
  unit: "s" | "min" | "h" | "d";
  context?: string;
};
export type CardIngredient = { name: string; quantity?: number; unit?: string; note?: string };

const TIME_LABELS: Record<NumberLocale, Record<CardTiming["unit"], readonly [string, string]>> = {
  "es-ES": { s: ["s", "s"], min: ["min", "min"], h: ["h", "h"], d: ["día", "días"] },
  en: { s: ["s", "s"], min: ["min", "min"], h: ["h", "h"], d: ["day", "days"] },
  ru: { s: ["с", "с"], min: ["мин", "мин"], h: ["ч", "ч"], d: ["сут", "сут"] },
};

/** `10–15 min`, `2 h`, `1 day`. Times are never converted. */
export function formatTiming(
  t: Pick<CardTiming, "value" | "valueMax" | "unit">,
  locale: NumberLocale,
): string {
  const amount =
    t.valueMax !== undefined && t.valueMax !== t.value
      ? `${formatNumber(t.value, locale)}–${formatNumber(t.valueMax, locale)}`
      : formatNumber(t.value, locale);
  const [one, many] = TIME_LABELS[locale][t.unit];
  const plural = (t.valueMax ?? t.value) !== 1;
  return `${amount} ${plural ? many : one}`;
}

export type ConversionEntry = {
  kind: "TEMPERATURE" | "TIMING" | "INGREDIENT";
  /** The card's own context or ingredient name. */
  label: string;
  /** The value as the card states it, in the market's number format. */
  source: string;
  /** What the market copy should say. */
  display: string;
};

/**
 * The deterministic table injected into the adapter and writer prompts (07 §7.9.3): for every
 * number of the cards, the exact string to use for the market.
 */
export function buildConversionTable(
  card: {
    temperatures?: readonly CardTemperature[];
    timings?: readonly CardTiming[];
    ingredients?: readonly CardIngredient[];
  },
  market: MarketUnits,
): ConversionEntry[] {
  const entries: ConversionEntry[] = [];
  for (const t of card.temperatures ?? []) {
    const q: Quantity = { value: t.value, unit: t.unit };
    entries.push({
      kind: "TEMPERATURE",
      label: t.context ?? t.target ?? "",
      source: formatQuantity(q, market.locale),
      display: displayQuantity(q, market, t.target),
    });
  }
  for (const t of card.timings ?? []) {
    const text = formatTiming(t, market.locale);
    entries.push({ kind: "TIMING", label: t.context ?? "", source: text, display: text });
  }
  for (const i of card.ingredients ?? []) {
    if (i.quantity === undefined || !i.unit) continue;
    const unit = parseUnit(i.unit);
    if (!isConvertible(unit) || unit === "C" || unit === "F") {
      const text = `${formatNumber(i.quantity, market.locale)} ${i.unit}`;
      entries.push({ kind: "INGREDIENT", label: i.name, source: text, display: text });
      continue;
    }
    const q: Quantity = { value: i.quantity, unit };
    entries.push({
      kind: "INGREDIENT",
      label: i.name,
      source: formatQuantity(q, market.locale),
      display: displayQuantity(q, market),
    });
  }
  return entries;
}
