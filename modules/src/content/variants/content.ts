import type { schema } from "@rc/db";
import type { ContentLength } from "@rc/db/json";
import { countChars, registry } from "@rc/templates";
import type { DraftContent } from "../validation";
import type { VariantContent } from "./field-path";

type VariantRow = typeof schema.contentVariants.$inferSelect;

/** The editable content of a stored variant. A variant with no draft yet has no content. */
export function contentOf(row: VariantRow): VariantContent | null {
  if (row.hook === null || row.caption === null) return null;
  // A Reel has no slides of its own: its caption, ask and hashtags are its editable content.
  if (row.slidesJson.length === 0 && row.format !== "REEL") return null;
  return {
    hook: row.hook,
    caption: row.caption,
    cta: row.ctaJson ?? { type: row.ctaType ?? "NONE", text: row.cta ?? "" },
    hashtags: row.hashtags,
    slides: row.slidesJson,
    visualBrief: row.visualBriefJson,
  };
}

const slideWords = (slots: Record<string, string>) =>
  Object.values(slots).join(" ").split(/\s+/).filter(Boolean).length;

/** The stored columns of `content`, with the ones derived from it (the CTA mirror, lengths, templates). */
export function columnsOf(content: VariantContent, hookType: string | null) {
  const contentLength: ContentLength = {
    slides: content.slides.length,
    wordsTotal: content.slides.reduce((sum, s) => sum + slideWords(s.slots), 0),
    captionChars: countChars(content.caption),
  };
  return {
    hook: content.hook,
    caption: content.caption,
    cta: content.cta.text,
    ctaType: content.cta.type,
    ctaJson: content.cta,
    hashtags: content.hashtags,
    slidesJson: content.slides,
    visualBriefJson: content.visualBrief,
    visualStyle: content.visualBrief?.visualStyle ?? null,
    templateSequence: content.slides.map((s) => s.templateId),
    contentLength,
    ...(hookType ? { hookType } : {}),
  };
}

/** The shape the validators take. */
export function toDraft(content: VariantContent, hookType: string | null): DraftContent {
  return {
    hook: content.hook,
    ...(hookType ? { hookType } : {}),
    caption: content.caption,
    cta: content.cta,
    hashtags: content.hashtags,
    slides: content.slides,
  };
}

/** Slot names of a slide's template in display order (jsonb does not keep the order). */
export function slotOrder(templateId: string): string[] {
  return Object.keys(registry.get(templateId)?.textSlots ?? {});
}
