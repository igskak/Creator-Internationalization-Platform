import type { Locale } from "./locales";

/** Plural forms of a message; `other` is required, the rest depend on the language's rules. */
export type PluralForms = { one: string; few?: string; many?: string; other: string };

/** Replaces `{name}` with the values given; an unknown placeholder is left as it is. */
export function format(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * The right plural form for `count` in the language (Intl.PluralRules: Russian has one, few and
 * many, English one and other), with `{count}` and any other values filled in.
 */
export function plural(
  locale: Locale,
  forms: PluralForms,
  count: number,
  vars: Record<string, string | number> = {},
): string {
  const category = new Intl.PluralRules(locale).select(count) as keyof PluralForms | "zero" | "two";
  const template =
    (category === "one" || category === "few" || category === "many"
      ? forms[category]
      : undefined) ?? forms.other;
  return format(template, { count, ...vars });
}

/** Numbers and dates in the language of the interface. */
export const formatNumber = (locale: Locale, value: number, digits = 0) =>
  new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
