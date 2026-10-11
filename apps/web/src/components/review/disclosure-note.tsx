"use client";

import type { SnapshotDisclosure } from "@rc/db/json";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";

/** What the market's AI-imagery setting adds to the post, shown where the reviewer decides (M5-12). */
export function DisclosureNote({ disclosure }: { disclosure: SnapshotDisclosure | null }) {
  const t = useI18n().messages.review.disclosure;
  if (!disclosure) return null;
  const text =
    disclosure.mode === "CAPTION_NOTE"
      ? format(t.captionNote, { note: disclosure.captionNote ?? "" })
      : disclosure.mode === "SLIDE_BADGE"
        ? t.badge
        : disclosure.mode === "PLATFORM_LABEL"
          ? t.platformLabel
          : null;
  if (!text) return null;
  return (
    <p
      className="rounded-md bg-muted p-2 text-sm"
      data-testid="disclosure-note"
      data-mode={disclosure.mode}
    >
      <span className="font-medium">{t.title}. </span>
      {text}
    </p>
  );
}
