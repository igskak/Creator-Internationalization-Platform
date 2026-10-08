import type { DifferentiationReport } from "@rc/db/json";
import { type EmbeddingProvider, embedTexts } from "@rc/lib/providers/embeddings";

// Cross-market differentiation (plan 07 §7.10, [S§7.3, §18], M2-11): are two markets' variants of
// one idea really different, or the same post in two languages? Deterministic scores from
// multilingual embeddings and the template sequence; the thresholds are placeholders (A-18) until
// they are calibrated at Gate G1, so each report records the version it used.

export type DifferentiationThresholds = {
  /** Stored in every report (`thresholdsVersion`); bump it with any change below. */
  version: string;
  hook: { warn: number; fail: number };
  slideText: { warn: number; fail: number };
  /** Template sequence similarity; only a WARN, a FAIL needs the same hook type too. */
  templateSequence: { warn: number };
  /** Visual prompt similarity; only a WARN until there is data (07 §7.10). */
  visualPrompt: { warn: number };
};

/** Placeholders from 07 §7.10 (A-18): calibrate on about 20 labelled pairs at Gate G1. */
export const DIFFERENTIATION_THRESHOLDS: DifferentiationThresholds = {
  version: "d1-placeholder",
  hook: { warn: 0.85, fail: 0.9 },
  slideText: { warn: 0.82, fail: 0.88 },
  templateSequence: { warn: 0.8 },
  visualPrompt: { warn: 0.9 },
};

/** A variant as the checker reads it; a stored `DraftContent` or `Slide` list fits. */
export type DifferentiationVariant = {
  marketCode: string;
  hook: string;
  hookType: string;
  slides: readonly {
    templateId: string;
    slots: Readonly<Record<string, string>>;
  }[];
  /** Image prompts of the visual brief, once there is one (M3). */
  visualPrompts?: readonly string[];
};

/** A variant with its texts already embedded. */
export type EmbeddedVariant = {
  hook: readonly number[];
  /** One vector per slide with text, in order. */
  slides: readonly (readonly number[])[];
  visuals?: readonly (readonly number[])[];
  templates: readonly string[];
  hookType: string;
};

const round = (x: number) => Math.round(x * 10_000) / 10_000;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Edit distance between two sequences (insert, delete, replace). */
export function levenshtein(a: readonly string[], b: readonly string[]): number {
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

/** Symmetric mean of the best-match cosine: for each text of A the closest text of B, and back. */
export function bestMatchSimilarity(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
): number {
  if (a.length === 0 || b.length === 0) return 0;
  const oneWay = (from: typeof a, to: typeof b) =>
    from.reduce((sum, v) => sum + Math.max(...to.map((w) => cosine(v, w))), 0) / from.length;
  return clamp01((oneWay(a, b) + oneWay(b, a)) / 2);
}

/** 1 − levenshtein / longer length; two empty sequences are the same. */
export function sequenceSimilarity(a: readonly string[], b: readonly string[]): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

/**
 * The 07 §7.10 rule over embedded variants. FAIL: hook ≥ fail, slide text ≥ fail, or the same
 * template sequence with the same hook type. WARN: any score at its warn level.
 */
export function scoreDifferentiation(
  a: EmbeddedVariant,
  b: EmbeddedVariant,
  thresholds: DifferentiationThresholds = DIFFERENTIATION_THRESHOLDS,
): DifferentiationReport {
  const hookSimilarity = round(clamp01(cosine(a.hook, b.hook)));
  const slideTextSimilarity = round(bestMatchSimilarity(a.slides, b.slides));
  const templateSequenceSimilarity = round(sequenceSimilarity(a.templates, b.templates));
  const sameHookType = a.hookType === b.hookType;
  const visualPromptSimilarity =
    a.visuals?.length && b.visuals?.length
      ? round(bestMatchSimilarity(a.visuals, b.visuals))
      : undefined;

  const fail: string[] = [];
  const warn: string[] = [];
  const pct = (x: number) => x.toFixed(2);
  if (hookSimilarity >= thresholds.hook.fail) {
    fail.push(`The hooks are almost the same (similarity ${pct(hookSimilarity)}).`);
  } else if (hookSimilarity >= thresholds.hook.warn) {
    warn.push(`The hooks are close (similarity ${pct(hookSimilarity)}).`);
  }
  if (slideTextSimilarity >= thresholds.slideText.fail) {
    fail.push(`The slide texts are almost the same (similarity ${pct(slideTextSimilarity)}).`);
  } else if (slideTextSimilarity >= thresholds.slideText.warn) {
    warn.push(`The slide texts are close (similarity ${pct(slideTextSimilarity)}).`);
  }
  if (templateSequenceSimilarity === 1 && sameHookType) {
    fail.push("Same hook type and the same template sequence.");
  } else if (templateSequenceSimilarity >= thresholds.templateSequence.warn) {
    warn.push(`The template sequences are alike (similarity ${pct(templateSequenceSimilarity)}).`);
  }
  if (
    visualPromptSimilarity !== undefined &&
    visualPromptSimilarity >= thresholds.visualPrompt.warn
  ) {
    warn.push(`The image prompts are close (similarity ${pct(visualPromptSimilarity)}).`);
  }

  return {
    hookSimilarity,
    slideTextSimilarity,
    templateSequenceSimilarity,
    sameHookType,
    ...(visualPromptSimilarity !== undefined ? { visualPromptSimilarity } : {}),
    verdict: fail.length > 0 ? "FAIL" : warn.length > 0 ? "WARN" : "OK",
    reasons: [...fail, ...warn],
    thresholdsVersion: thresholds.version,
  };
}

/** The text of a slide as one string: its slot texts in slot order. */
export const slideText = (slots: Readonly<Record<string, string>>): string =>
  Object.values(slots)
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" ");

export type PairReport = {
  a: string;
  b: string;
  report: DifferentiationReport;
};

/**
 * Compares every pair of the variants (one per market). All texts are embedded in one call. The
 * order of a pair follows the order given: callers pass the markets in generation order, so `b`
 * is the one generated later and is the one asked to change on a FAIL (07 §7.6.3).
 */
export async function differentiateVariants(
  embeddings: EmbeddingProvider,
  variants: readonly DifferentiationVariant[],
  thresholds: DifferentiationThresholds = DIFFERENTIATION_THRESHOLDS,
): Promise<PairReport[]> {
  if (variants.length < 2) return [];
  const texts: string[] = [];
  const slots = variants.map((v) => ({
    hook: texts.push(v.hook.trim()) - 1,
    slides: v.slides.map((s) => slideText(s.slots)).flatMap((t) => (t ? [texts.push(t) - 1] : [])),
    visuals: (v.visualPrompts ?? [])
      .map((p) => p.trim())
      .flatMap((t) => (t ? [texts.push(t) - 1] : [])),
  }));
  const vectors = (await embedTexts(embeddings, texts, { purpose: "document" })).map(
    (e) => e.vector,
  );
  const at = (i: number) => vectors[i] ?? [];
  const embedded: EmbeddedVariant[] = variants.map((v, i) => ({
    hook: at(slots[i]?.hook ?? -1),
    slides: (slots[i]?.slides ?? []).map(at),
    visuals: (slots[i]?.visuals ?? []).map(at),
    templates: v.slides.map((s) => s.templateId),
    hookType: v.hookType,
  }));

  const reports: PairReport[] = [];
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const [x, y] = [embedded[i], embedded[j]];
      if (!x || !y) continue;
      reports.push({
        a: variants[i]?.marketCode ?? "",
        b: variants[j]?.marketCode ?? "",
        report: scoreDifferentiation(x, y, thresholds),
      });
    }
  }
  return reports;
}

const SEVERITY = { OK: 0, WARN: 1, FAIL: 2 } as const;

/** The worst report of a set, e.g. the one a variant carries when it has several siblings. */
export function worstReport(reports: readonly PairReport[]): PairReport | undefined {
  return reports.reduce<PairReport | undefined>(
    (worst, r) =>
      !worst || SEVERITY[r.report.verdict] > SEVERITY[worst.report.verdict] ? r : worst,
    undefined,
  );
}
