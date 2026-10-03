"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { Messages } from "./en";
import type { Locale } from "./locales";

type I18n = { locale: Locale; messages: Messages };
const I18nContext = createContext<I18n | null>(null);

/** Gives client components the language and the messages chosen on the server. */
export function I18nProvider({ locale, messages, children }: I18n & { children: ReactNode }) {
  return <I18nContext value={{ locale, messages }}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>.");
  return value;
}
