import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n/provider";
import { getI18n } from "@/lib/i18n/server";
import "./globals.css";

// System font stack: no build-time font download (cloud sessions have restricted network).
// Brand fonts for carousels live in @rc/templates (M3).

export const metadata: Metadata = {
  title: "RegChef Content Engine",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, messages } = await getI18n();
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <I18nProvider locale={locale} messages={messages}>
          <TooltipProvider>{children}</TooltipProvider>
        </I18nProvider>
        {/* Top: forms keep their save buttons in a sticky bar at the bottom right. */}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
