"use client";

import { ShieldAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CardFlagValue } from "@/lib/cards-query";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const FLAG_STYLE: Record<CardFlagValue, string> = {
  SAFETY_SENSITIVE: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  QUOTE_UNVERIFIED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  LOW_CONFIDENCE: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  DUPLICATE_SUSPECTED: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
};

/** The review flags of a card as badges; the hint says what each one means. */
export function FlagBadges({ flags }: { flags: string[] }) {
  const { messages } = useI18n();
  return (
    <>
      {flags.map((flag) =>
        flag in FLAG_STYLE ? (
          <Badge
            key={flag}
            variant="ghost"
            title={messages.cards.flagHints[flag as CardFlagValue]}
            className={cn(FLAG_STYLE[flag as CardFlagValue])}
          >
            {flag === "SAFETY_SENSITIVE" ? <ShieldAlertIcon aria-hidden="true" /> : null}
            {messages.cards.flags[flag as CardFlagValue]}
          </Badge>
        ) : null,
      )}
    </>
  );
}
