import {
  CUP_ML,
  FLOZ_ML,
  formatNumber,
  IN_CM,
  LB_G,
  type NumberLocale,
  OZ_G,
  parseUnit,
  type ScanUnit,
  UNIT_PATTERNS,
} from "./units";

// Numeric fidelity (plan 07 §7.9.3): numbers with units are pulled out of generated text and
// compared with the numbers on the cited cards. A number with no match is NUMERIC_MISMATCH.
// Numbers without a unit ("3 mistakes", "5 slides") are not checked.

export type ExtractedNumber = {
  /** The matched text, e.g. "10–15 min". */
  raw: string;
  index: number;
  value: number;
  /** Upper end of a range such as "10–15 min". */
  valueMax?: number;
  unit: ScanUnit;
};

type Family = "temperature" | "time" | "mass" | "volume" | "length" | "percent";

const FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
};
const GLYPHS = Object.keys(FRACTIONS).join("");

// "1/2", "1 1/2", "1.5", "1,5", "1.500", "1½", "½"
const AMOUNT = String.raw`\d+\/\d+|\d+\s\d\/\d|(?:\d[\d.,]*\d|\d)\s?[${GLYPHS}]|[${GLYPHS}]|\d[\d.,]*\d|\d`;
const UNITS = UNIT_PATTERNS.map((p) => p.source).join("|");
const SCANNER = new RegExp(
  String.raw`(?<![\p{L}\d])(${AMOUNT})(?:\s*(?:-|–|—|a|to|hasta)\s*(${AMOUNT}))?\s*(${UNITS})(?![\p{L}\d])`,
  "giu",
);

function decimalComma(locale: NumberLocale) {
  return locale !== "en";
}

/** "1,5" / "1.5" / "1.500" / "1½" / "1/2" → number, by the locale's separator convention. */
export function parseAmount(token: string, locale: NumberLocale): number | undefined {
  const text = token.trim();
  const glyph = text.match(new RegExp(`^(\\d[\\d.,]*)?\\s?([${GLYPHS}])$`, "u"));
  if (glyph) {
    const whole = glyph[1] ? parseAmount(glyph[1], locale) : 0;
    const fraction = FRACTIONS[glyph[2] ?? ""];
    return whole === undefined || fraction === undefined ? undefined : whole + fraction;
  }
  const slash = text.match(/^(?:(\d+)\s)?(\d+)\/(\d+)$/);
  if (slash) {
    const denominator = Number(slash[3]);
    return denominator === 0 ? undefined : Number(slash[1] ?? 0) + Number(slash[2]) / denominator;
  }
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized = text;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    normalized = text
      .split(decimal === "," ? "." : ",")
      .join("")
      .replace(",", ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const isThousands = new RegExp(`^\\d{1,3}(\\${separator}\\d{3})+$`).test(text);
    const decimalSeparator = decimalComma(locale) ? "," : ".";
    if (separator === decimalSeparator) normalized = text.replace(separator, ".");
    else if (isThousands) normalized = text.split(separator).join("");
    else normalized = text.replace(separator, ".");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/** Numbers with units in `text`; "1 h 30 min" is one 90-minute number. */
export function extractNumbers(text: string, locale: NumberLocale = "en"): ExtractedNumber[] {
  const found: (ExtractedNumber & { end: number })[] = [];
  for (const match of text.matchAll(SCANNER)) {
    const [raw, first, second, unitText] = match;
    const unit = parseUnit(unitText ?? "");
    const value = parseAmount(first ?? "", locale);
    if (unit === undefined || value === undefined) continue;
    const valueMax = second === undefined ? undefined : parseAmount(second, locale);
    found.push({
      raw,
      index: match.index,
      end: match.index + raw.length,
      value,
      unit,
      ...(valueMax === undefined ? {} : { valueMax }),
    });
  }
  const merged: ExtractedNumber[] = [];
  for (let i = 0; i < found.length; i += 1) {
    const current = found[i];
    const next = found[i + 1];
    if (!current) continue;
    if (
      next &&
      current.unit === "h" &&
      next.unit === "min" &&
      current.valueMax === undefined &&
      next.valueMax === undefined &&
      /^\s*(?:,|and|y|con|e)?\s*$/i.test(text.slice(current.end, next.index))
    ) {
      merged.push({
        raw: text.slice(current.index, next.end),
        index: current.index,
        value: current.value * 60 + next.value,
        unit: "min",
      });
      i += 1;
      continue;
    }
    const { end: _end, ...rest } = current;
    merged.push(rest);
  }
  return merged;
}

// ---------------------------------------------------------------------------------------------
// Reference values
// ---------------------------------------------------------------------------------------------

export type NumericReference = {
  temperatures?: readonly { value: number; unit: "C" | "F" }[];
  timings?: readonly { value: number; valueMax?: number; unit: "s" | "min" | "h" | "d" }[];
  ingredients?: readonly { quantity?: number; unit?: string }[];
  /**
   * Free card text (claim, explanation, steps …). Numbers with units found there are allowed too,
   * because ratios and percentages have no structured field.
   */
  texts?: readonly string[];
  /** Number convention of `texts`; cards are mostly Russian. */
  textLocale?: NumberLocale;
};

type Ref = { lo: number; hi: number; tol: number };
type RefIndex = Record<Family, Ref[]>;

const FAMILY: Record<ScanUnit, Family | "deg"> = {
  C: "temperature",
  F: "temperature",
  deg: "deg",
  s: "time",
  min: "time",
  h: "time",
  d: "time",
  g: "mass",
  kg: "mass",
  oz: "mass",
  lb: "mass",
  ml: "volume",
  l: "volume",
  floz: "volume",
  cup: "volume",
  cm: "length",
  in: "length",
  "%": "percent",
};

/** Value in the family's base unit: °C, minutes, g, ml, cm, percent. Bare degrees count as °C. */
function toBase(value: number, unit: ScanUnit): number {
  switch (unit) {
    case "F":
      return ((value - 32) * 5) / 9;
    case "s":
      return value / 60;
    case "h":
      return value * 60;
    case "d":
      return value * 1440;
    case "kg":
    case "l":
      return value * 1000;
    case "oz":
      return value * OZ_G;
    case "lb":
      return value * LB_G;
    case "floz":
      return value * FLOZ_ML;
    case "cup":
      return value * CUP_ML;
    case "in":
      return value * IN_CM;
    default:
      return value;
  }
}

/** Half a display step in base units: how far a rounded imperial value may sit from the exact one. */
function stepTolerance(unit: ScanUnit): number {
  switch (unit) {
    case "oz":
      return 0.125 * OZ_G;
    case "lb":
      return 0.05 * LB_G;
    case "floz":
      return 0.25 * FLOZ_ML;
    case "in":
      return 0.125 * IN_CM;
    default:
      return 0;
  }
}

const TEMPERATURE_TOLERANCE = { C: 2, F: 5 } as const;

function addRef(index: RefIndex, value: number, valueMax: number | undefined, unit: ScanUnit) {
  const family = FAMILY[unit];
  const lo = toBase(value, unit);
  const hi = valueMax === undefined ? lo : toBase(valueMax, unit);
  index[family === "deg" ? "temperature" : family].push({
    lo: Math.min(lo, hi),
    hi: Math.max(lo, hi),
    tol: stepTolerance(unit),
  });
}

export function buildReferenceIndex(reference: NumericReference): RefIndex {
  const index: RefIndex = {
    temperature: [],
    time: [],
    mass: [],
    volume: [],
    length: [],
    percent: [],
  };
  for (const t of reference.temperatures ?? []) addRef(index, t.value, undefined, t.unit);
  for (const t of reference.timings ?? []) addRef(index, t.value, t.valueMax, t.unit);
  for (const i of reference.ingredients ?? []) {
    const unit = i.unit ? parseUnit(i.unit) : undefined;
    if (i.quantity !== undefined && unit !== undefined && unit !== "deg")
      addRef(index, i.quantity, undefined, unit);
  }
  for (const text of reference.texts ?? []) {
    for (const n of extractNumbers(text, reference.textLocale ?? "ru"))
      addRef(index, n.value, n.valueMax, n.unit);
  }
  return index;
}

const EPSILON = 1e-6;

function endpointMatches(value: number, unit: ScanUnit, index: RefIndex): boolean {
  const family = FAMILY[unit];
  if (family === "deg") {
    return endpointMatches(value, "C", index) || endpointMatches(value, "F", index);
  }
  const base = toBase(value, unit);
  if (family === "temperature") {
    // Compare in the unit the text uses: ±2 °C or ±5 °F.
    const limit = TEMPERATURE_TOLERANCE[unit === "F" ? "F" : "C"];
    const scale = unit === "F" ? 9 / 5 : 1;
    return index.temperature.some(
      (r) => base >= r.lo - limit / scale - EPSILON && base <= r.hi + limit / scale + EPSILON,
    );
  }
  if (family === "time")
    return index.time.some((r) => base >= r.lo - EPSILON && base <= r.hi + EPSILON);
  if (family === "percent")
    return index.percent.some(
      (r) => Math.abs(base - r.lo) <= 0.01 || (base >= r.lo && base <= r.hi),
    );
  const relative = unit === "cup" ? 0.06 : 0.01;
  return index[family].some((r) => {
    const tolerance = Math.max(relative * Math.abs(base), stepTolerance(unit), r.tol);
    return base >= r.lo - tolerance - EPSILON && base <= r.hi + tolerance + EPSILON;
  });
}

/** A range matches when both ends do. */
function matches(n: ExtractedNumber, index: RefIndex): boolean {
  return (
    endpointMatches(n.value, n.unit, index) &&
    (n.valueMax === undefined || endpointMatches(n.valueMax, n.unit, index))
  );
}

/** Numbers with units in `text` that no reference value explains. */
export function findNumericMismatches(
  text: string,
  reference: NumericReference,
  options: { locale?: NumberLocale; index?: RefIndex } = {},
): ExtractedNumber[] {
  const index = options.index ?? buildReferenceIndex(reference);
  return extractNumbers(text, options.locale ?? "en").filter((n) => !matches(n, index));
}

export type NumericIssue = {
  code: "NUMERIC_MISMATCH";
  severity: "BLOCKER";
  fieldPath: string;
  message: string;
  fixHint: string;
};

const BASE_LABEL: Record<Family, string> = {
  temperature: "°C",
  time: "min",
  mass: "g",
  volume: "ml",
  length: "cm",
  percent: "%",
};

function describeCandidates(family: Family | "deg", index: RefIndex): string {
  const key = family === "deg" ? "temperature" : family;
  const values = [
    ...new Set(
      index[key].map((r) =>
        r.lo === r.hi
          ? formatNumber(Math.round(r.lo * 100) / 100, "en")
          : `${formatNumber(Math.round(r.lo * 100) / 100, "en")}–${formatNumber(Math.round(r.hi * 100) / 100, "en")}`,
      ),
    ),
  ];
  return values.length > 0
    ? `Cards give: ${values.slice(0, 6).join(", ")} ${BASE_LABEL[key]}.`
    : "The cards give no number of this kind.";
}

/**
 * NUMERIC_MISMATCH (BLOCKER) for every number in the given fields that the cards do not support.
 * `locale` is the language of the generated text (es-ES decimal comma, en decimal point).
 */
export function checkNumericFidelity(
  fields: readonly { fieldPath: string; text: string }[],
  reference: NumericReference,
  options: { locale: NumberLocale },
): NumericIssue[] {
  const index = buildReferenceIndex(reference);
  const issues: NumericIssue[] = [];
  for (const field of fields) {
    for (const n of findNumericMismatches(field.text, reference, {
      locale: options.locale,
      index,
    })) {
      issues.push({
        code: "NUMERIC_MISMATCH",
        severity: "BLOCKER",
        fieldPath: field.fieldPath,
        message: `"${n.raw}" does not match any number on the cited cards.`,
        fixHint: `Use a value from the cards or the conversion table. ${describeCandidates(FAMILY[n.unit], index)}`,
      });
    }
  }
  return issues;
}
