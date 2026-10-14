import { findBannedHookPatterns, type HookLanguage } from "@rc/prompts";
import { stripEmphasis } from "@rc/templates";
import { extractNumbers, type NumberLocale } from "../../localization";
import type { DraftContent, ValidationContext, ValidationIssue, Validator } from "./types";

// Hook line checks (docs/design/hook-library.md §3 and §5, M2-12b). The hook is the line a cold
// reader sees first, so it must not promise what the cards cannot back:
// - HOOK_BANNED_PATTERN: an invented experience, a guarantee, conspiracy framing, a time promise
//   or empty hype (the same lists the writer prompt names);
// - HOOK_NUMBER_UNSUPPORTED: a bare number ("3 ways") that is on no card and is not the count of
//   the carousel's body slides. Numbers with units are the numeric-fidelity validator's job.

const HOOK_LANGUAGE: Partial<Record<NumberLocale, HookLanguage>> = { en: "en", "es-ES": "es" };
const BARE_NUMBER = /(?<![\p{L}\d.,])\d+(?![\p{L}\d]|[.,]\d)/gu;
/** "1" is allowed anywhere: "1 rule", "the 1:2 ratio" are not claims of their own. */
const ALWAYS_ALLOWED = new Set([1]);

/** The texts of the hook: the hook line and every slot of the HOOK slide, as the reader sees them. */
function hookTexts(draft: DraftContent): { fieldPath: string; text: string }[] {
  return [
    { fieldPath: "hook", text: draft.hook },
    ...draft.slides
      .filter((slide) => slide.role === "HOOK")
      .flatMap((slide) =>
        Object.entries(slide.slots).map(([slot, text]) => ({
          fieldPath: `slides.${slide.id}.slots.${slot}`,
          text: stripEmphasis(text),
        })),
      ),
  ];
}

function integersIn(text: string): number[] {
  return [...text.matchAll(BARE_NUMBER)].map((m) => Number(m[0]));
}

/** Every whole number a card states, structured or in its text. */
function cardIntegers(context: ValidationContext): Set<number> {
  const ref = context.numericReference;
  const numbers = new Set<number>();
  for (const t of ref.temperatures ?? []) numbers.add(t.value);
  for (const t of ref.timings ?? []) {
    numbers.add(t.value);
    if (t.valueMax !== undefined) numbers.add(t.valueMax);
  }
  for (const i of ref.ingredients ?? []) if (i.quantity !== undefined) numbers.add(i.quantity);
  for (const text of ref.texts ?? []) for (const n of integersIn(text)) numbers.add(n);
  return numbers;
}

/** A text without the numbers that carry a unit: those are checked by numeric fidelity. */
function withoutUnitNumbers(text: string, locale: NumberLocale): string {
  let result = text;
  for (const found of extractNumbers(text, locale).sort((a, b) => b.index - a.index)) {
    result =
      result.slice(0, found.index) +
      " ".repeat(found.raw.length) +
      result.slice(found.index + found.raw.length);
  }
  return result;
}

export const validateHookLine: Validator = (draft, context) => {
  const issues: ValidationIssue[] = [];
  const language = HOOK_LANGUAGE[context.locale];
  const fromCards = cardIntegers(context);
  const bodySlides = draft.slides.filter((s) => s.role !== "HOOK" && s.role !== "CTA").length;

  for (const { fieldPath, text } of hookTexts(draft)) {
    if (language) {
      for (const { match } of findBannedHookPatterns(text, language)) {
        issues.push({
          code: "HOOK_BANNED_PATTERN",
          severity: "BLOCKER",
          fieldPath,
          message: `"${match}" promises or claims what the cards do not support.`,
          fixHint: `Rewrite the hook without "${match}": no invented experience, guarantee, conspiracy framing, time promise or empty hype. State a claim from a card instead.`,
        });
      }
    }
    for (const n of integersIn(withoutUnitNumbers(text, context.locale))) {
      if (ALWAYS_ALLOWED.has(n) || fromCards.has(n) || n === bodySlides) continue;
      issues.push({
        code: "HOOK_NUMBER_UNSUPPORTED",
        severity: "BLOCKER",
        fieldPath,
        message: `The hook says ${n}, which no card states and which is not the number of points in the carousel (${bodySlides}).`,
        fixHint: `Use a number from the cards, make it match the ${bodySlides} body slides, or drop the number.`,
      });
    }
  }
  return issues;
};
