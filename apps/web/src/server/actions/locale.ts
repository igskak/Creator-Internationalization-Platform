"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/locales";

/**
 * Stores the interface language in a cookie and refreshes the page. It only changes how the screens
 * are written, so it needs no sign-in check and no audit event.
 */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
