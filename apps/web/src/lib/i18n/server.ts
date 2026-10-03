import "server-only";
import { cookies } from "next/headers";
import { en, type Messages } from "./en";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./locales";
import { ru } from "./ru";

const CATALOGS: Record<Locale, Messages> = { en, ru };

/** The interface language of this request: the `rc-locale` cookie, else English. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export const messagesFor = (locale: Locale): Messages => CATALOGS[locale];

export async function getI18n() {
  const locale = await getLocale();
  return { locale, messages: messagesFor(locale) };
}
