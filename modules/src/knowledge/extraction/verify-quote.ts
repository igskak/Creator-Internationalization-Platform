// Quote and number verification (plan 07 §7.2.4). The model's quote must really be in the cited
// pages and the numbers it structured must really be stated there; code decides, not the model.

export const QUOTE_VERIFIED_THRESHOLD = 0.9;

const QUOTE_MARKS = /[«»„“”‟"‹›]/g;
const APOSTROPHES = /[‘’‚‛`´]/g;
const DASHES = /[‐‑‒–—―−﹘﹣－]/g;

/**
 * Text prepared for comparison: NFKC, lower case, `ё → е`, one kind of quotes and dashes, soft
 * hyphens removed, spaces collapsed. Words split by a hyphen at a line end are joined
 * (`hyphenation: "join"`) or keep the hyphen (`"keep"`), since a real hyphen (что-то) can also
 * fall at a line end; matching tries both.
 */
export function normalizeForMatch(text: string, hyphenation: "join" | "keep" = "keep"): string {
  return text
    .normalize("NFKC")
    .replace(/­[ \t]*\r?\n[ \t]*/g, "")
    .replace(/[­​-‍﻿]/g, "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(QUOTE_MARKS, '"')
    .replace(APOSTROPHES, "'")
    .replace(DASHES, "-")
    .replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{L})/gu, hyphenation === "join" ? "$1$2" : "$1-$2")
    .replace(/\s+/g, " ")
    .trim();
}

const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
const tokens = (text: string) =>
  text
    .split(" ")
    .map((token) => token.replace(EDGE_PUNCTUATION, ""))
    .filter(Boolean);

/** Edit distance between two token sequences. */
function distance(a: readonly string[], b: readonly string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

/**
 * Best token-level similarity (1 − distance / length) of the quote with any window of the text.
 * Scores below about 0.4 are not computed exactly: a window needs at least 40 % of the quote's
 * words to reach that, which a prefix sum rules out cheaply before the edit-distance step.
 */
function fuzzyScore(quote: readonly string[], text: readonly string[]): number {
  const n = quote.length;
  if (n === 0 || text.length === 0) return 0;
  const lengths = new Set(
    [Math.ceil(n * 0.8), n, Math.floor(n * 1.2)].map((l) => Math.max(1, Math.min(l, text.length))),
  );
  const wanted = new Set(quote);
  const shared = [0];
  for (const token of text) shared.push((shared.at(-1) ?? 0) + (wanted.has(token) ? 1 : 0));
  const minShared = Math.ceil(n * 0.4);
  let best = 0;
  for (const length of lengths) {
    for (let start = 0; start + length <= text.length; start++) {
      if ((shared[start + length] ?? 0) - (shared[start] ?? 0) < minShared) continue;
      const window = text.slice(start, start + length);
      best = Math.max(best, 1 - distance(quote, window) / Math.max(n, length));
      if (best === 1) return 1;
    }
  }
  return best;
}

export type QuoteCheck = { score: number; verified: boolean };

/**
 * Looks for `quote` in the cited pages ± 1 (`pages` may hold more). An exact substring scores 1;
 * otherwise the best fuzzy window decides. `verified` = score ≥ 0.90.
 */
export function verifyQuote(
  quote: string,
  pages: readonly { pageNumber: number; text: string }[],
  cited: { pageStart: number; pageEnd: number },
): QuoteCheck {
  const near = pages
    .filter((p) => p.pageNumber >= cited.pageStart - 1 && p.pageNumber <= cited.pageEnd + 1)
    .sort((a, b) => a.pageNumber - b.pageNumber);
  const wanted = normalizeForMatch(quote);
  if (!wanted || near.length === 0) return { score: 0, verified: false };

  // Both readings of a hyphen at a line end; when they are the same text, search it once.
  const haystacks = new Set(
    (["keep", "join"] as const).map((mode) =>
      near.map((p) => normalizeForMatch(p.text, mode)).join(" "),
    ),
  );
  let score = 0;
  for (const haystack of haystacks) {
    if (haystack.includes(wanted)) return { score: 1, verified: true };
    score = Math.max(score, fuzzyScore(tokens(wanted), tokens(haystack)));
  }
  const rounded = Math.round(score * 100) / 100;
  return { score: rounded, verified: rounded >= QUOTE_VERIFIED_THRESHOLD };
}

// --- numbers --------------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {};
const words = (value: number, list: string) => {
  for (const word of list.split(" ")) NUMBER_WORDS[word] = value;
};
// Russian (ё already folded to е), Spanish and English, for the numbers that occur in recipes.
words(1, "один одна одно одну одного одной одним uno one");
words(2, "два две двух двум двумя dos two");
words(3, "три трех трем тремя tres three");
words(4, "четыре четырех четырем cuatro four");
words(5, "пять пяти пятью cinco five");
words(6, "шесть шести seis six");
words(7, "семь семи siete seven");
words(8, "восемь восьми ocho eight");
words(9, "девять девяти nueve nine");
words(10, "десять десяти diez ten");
words(12, "двенадцать двенадцати doce twelve");
words(15, "пятнадцать пятнадцати quince fifteen");
words(20, "двадцать двадцати veinte twenty");
words(30, "тридцать тридцати treinta thirty");
words(60, "шестьдесят шестидесяти sesenta sixty");

/** Singular unit words that state "one" without a digit ("в течение суток"). */
const IMPLICIT_ONE: Record<string, readonly string[]> = {
  d: ["сутки", "суток", "суткам", "сутками", "день", "дня", "дню", "day", "dia", "día", "dias"],
  h: ["час", "часа", "часу", "hour", "hora"],
  min: ["минуту", "минуты", "minute", "minuto"],
  s: ["секунду", "секунды", "second", "segundo"],
};

/** Numbers stated in a text, as digits (`10`, `0,5`, `+4`, `10–15`) or as words (`двух`, `dos`, `two`). */
export function statedNumbers(text: string): Set<number> {
  const normalized = normalizeForMatch(text, "join");
  const found = new Set<number>();
  for (const match of normalized.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)(?!\d)/g)) {
    found.add(Number((match[1] ?? "").replace(",", ".")));
  }
  for (const word of normalized.split(/[^\p{L}]+/u)) {
    const value = NUMBER_WORDS[word];
    if (value !== undefined) found.add(value);
  }
  return found;
}

export type NumberCheck = { missing: string[] };

/**
 * Every value in `temperatures` and `timings` (and `valueMax`) must be stated on the cited pages.
 * Value 1 is also accepted when the unit is named in the singular ("сутки", "hour").
 */
export function verifyNumbers(
  card: {
    temperatures: readonly { value: number }[];
    timings: readonly { value: number; valueMax?: number | undefined; unit: string }[];
  },
  pages: readonly { pageNumber: number; text: string }[],
  cited: { pageStart: number; pageEnd: number },
): NumberCheck {
  const text = pages
    .filter((p) => p.pageNumber >= cited.pageStart && p.pageNumber <= cited.pageEnd)
    .map((p) => p.text)
    .join("\n");
  const stated = statedNumbers(text);
  const tokenSet = new Set(normalizeForMatch(text, "join").split(/[^\p{L}]+/u));
  const missing: string[] = [];
  const check = (value: number, unit?: string) => {
    if (stated.has(value)) return;
    if (value === 1 && unit && IMPLICIT_ONE[unit]?.some((word) => tokenSet.has(word))) return;
    missing.push(String(value));
  };
  for (const t of card.temperatures) check(t.value);
  for (const t of card.timings) {
    check(t.value, t.unit);
    if (t.valueMax !== undefined) check(t.valueMax, t.unit);
  }
  return { missing: [...new Set(missing)] };
}
