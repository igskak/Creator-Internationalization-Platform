// UI languages (owner request 2026-10-03): English by default, Russian for the team. The choice is a
// cookie, not part of the URL: routes stay as in plan 10 §10.2.

export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "rc-locale";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** Names shown in the language switch, each in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ru: "Русский" };
