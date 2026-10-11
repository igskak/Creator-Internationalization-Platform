"use client";

import type { Slide } from "@rc/db/json";
import { ExpandIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { RegeneratePopover } from "./regenerate-popover";
import { RegenerationDiff } from "./regeneration-diff";
import { fieldDomId, useVariant } from "./variant-state";

/** One slide in the column: its texts, its cited cards, and the buttons that open or redo it. */
export function SlideCard({
  slide,
  index,
  cardTitles,
}: {
  slide: Slide;
  index: number;
  cardTitles: Record<string, string>;
}) {
  const { messages } = useI18n();
  const t = messages.review;
  const e = t.edit;
  const variant = useVariant();
  const path = `slides.${slide.id}`;

  return (
    <li
      id={fieldDomId(variant.variantId, path)}
      data-field={path}
      className="flex flex-col gap-1.5 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{format(t.slide, { n: index + 1 })}</span>
        <span className="flex items-center gap-1">
          {format(t.slideMeta, { role: slide.role, template: slide.templateId })}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={format(e.slide.open, { n: index + 1 })}
            onClick={() => variant.setOpenSlide(slide.id)}
          >
            <ExpandIcon />
          </Button>
          <RegeneratePopover path={path} fieldLabel={format(e.field.slide, { n: index + 1 })} />
        </span>
      </div>
      <dl className="flex flex-col gap-1">
        {Object.entries(slide.slots).map(([slot, text]) => (
          <div key={slot}>
            <dt className="font-mono text-[11px] text-muted-foreground">{slot}</dt>
            <dd className="whitespace-pre-line">{text}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {slide.knowledgeIds.length > 0 ? (
          <>
            <span className="text-muted-foreground">{t.cites}:</span>
            {slide.knowledgeIds.map((id) => (
              <Badge key={id} variant="outline">
                {cardTitles[id] ?? id}
              </Badge>
            ))}
          </>
        ) : (
          <span className="text-muted-foreground">{t.notFactual}</span>
        )}
      </div>
      <RegenerationDiff path={path} />
    </li>
  );
}
